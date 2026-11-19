const hubspot = require('@hubspot/api-client');
const HubspotConnection = require('../db/models/HubspotConnection');

const ENCRYPTION_KEY = process.env.HUBSPOT_ENCRYPTION_KEY
    || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const IV_LENGTH = 16;

function encrypt(text) {
    const crypto = require('crypto');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    const crypto = require('crypto');
    const textParts = String(text || '').split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

function defaultRedirectUri() {
    const base = (process.env.API_BASE_URL || process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '');
    return process.env.HUBSPOT_REDIRECT_URI || `${base}/hubspot/callback`;
}

class HubspotClientService {
    constructor() {
        this.clientId = process.env.HUBSPOT_CLIENT_ID;
        this.clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
        this.redirectUri = defaultRedirectUri();
    }

    encrypt(text) {
        return encrypt(text);
    }

    async isConnected(orgId) {
        if (process.env.HUBSPOT_API_KEY) return true;
        if (!orgId) return false;
        const connection = await HubspotConnection.findOne({ orgId }).select('_id').lean();
        return !!connection;
    }

    async getClientForOrg(orgId) {
        if (process.env.HUBSPOT_API_KEY) {
            return new hubspot.Client({ accessToken: process.env.HUBSPOT_API_KEY });
        }

        const connection = await HubspotConnection.findOne({ orgId });
        if (!connection) {
            throw new Error(`No HubSpot connection found for org ${orgId}`);
        }

        let accessToken = decrypt(connection.accessToken);

        if (Date.now() + 5 * 60 * 1000 > connection.expiresAt.getTime()) {
            const refreshToken = decrypt(connection.refreshToken);
            try {
                const tempClient = new hubspot.Client();
                const results = await tempClient.oauth.tokensApi.create(
                    'refresh_token',
                    undefined,
                    undefined,
                    this.clientId,
                    this.clientSecret,
                    refreshToken
                );

                accessToken = results.accessToken;
                connection.accessToken = encrypt(results.accessToken);
                connection.refreshToken = encrypt(results.refreshToken);
                connection.expiresAt = new Date(Date.now() + results.expiresIn * 1000);
                await connection.save();
            } catch (err) {
                console.error(`[HubspotClient] Failed to refresh token for org ${orgId}:`, err.message);
                throw new Error('HubSpot authentication expired and could not be refreshed.');
            }
        }

        return new hubspot.Client({ accessToken });
    }

    async searchContact(orgId, { email, name }) {
        try {
            const client = await this.getClientForOrg(orgId);
            const properties = [
                'firstname', 'lastname', 'email', 'jobtitle', 'phone', 'company', 'associatedcompanyid',
                'lifecyclestage', 'hs_lead_status', 'city', 'state', 'country',
                'linkedinbio', 'hs_analytics_source', 'notes_last_contacted', 'notes_next_activity_date',
                'hs_email_last_email_date', 'num_associated_deals'
            ];

            if (email) {
                const byEmail = await client.crm.contacts.searchApi.doSearch({
                    filterGroups: [{
                        filters: [{ propertyName: 'email', operator: 'EQ', value: String(email).trim().toLowerCase() }]
                    }],
                    properties,
                    limit: 1
                });
                if (byEmail.total > 0) return byEmail.results[0];
            }

            if (name) {
                const parts = String(name).trim().split(/\s+/).filter(Boolean);
                const firstName = parts[0];
                const lastName = parts.slice(1).join(' ');
                const filters = [{ propertyName: 'firstname', operator: 'EQ', value: firstName }];
                if (lastName) {
                    filters.push({ propertyName: 'lastname', operator: 'EQ', value: lastName });
                }
                const byName = await client.crm.contacts.searchApi.doSearch({
                    filterGroups: [{ filters }],
                    properties,
                    limit: 1
                });
                if (byName.total > 0) return byName.results[0];
            }

            return null;
        } catch (err) {
            console.error('[HubspotClient] searchContact error:', err.message);
            return null;
        }
    }

    async getCompany(orgId, companyId) {
        if (!companyId) return null;
        try {
            const client = await this.getClientForOrg(orgId);
            return await client.crm.companies.basicApi.getById(
                companyId,
                [
                    'name', 'domain', 'industry', 'numberofemployees', 'description',
                    'annualrevenue', 'city', 'state', 'country', 'type', 'website', 'founded_year'
                ]
            );
        } catch (err) {
            console.error('[HubspotClient] getCompany error:', err.message);
            return null;
        }
    }

    async getDealsForContact(orgId, contactId) {
        if (!contactId) return [];
        try {
            const client = await this.getClientForOrg(orgId);
            const associations = await client.crm.contacts.associationsApi.getAll(contactId, 'deals');
            if (!associations || !associations.results || associations.results.length === 0) {
                return [];
            }

            const deals = [];
            for (const assoc of associations.results) {
                try {
                    const deal = await client.crm.deals.basicApi.getById(
                        assoc.id,
                        ['dealname', 'dealstage', 'amount', 'pipeline', 'closedate', 'description', 'dealtype', 'hs_next_step', 'hs_priority']
                    );
                    deals.push(deal);
                } catch (e) {
                    console.warn(`[HubspotClient] Could not fetch deal ${assoc.id}`);
                }
            }
            return deals;
        } catch (err) {
            console.error('[HubspotClient] getDealsForContact error:', err.message);
            return [];
        }
    }

    async getFullContext(orgId, { email, name }) {
        const result = {
            contact: null,
            company: null,
            deals: [],
            fetchedAt: new Date().toISOString()
        };

        const contact = await this.searchContact(orgId, { email, name });
        if (!contact) return result;

        result.contact = {
            id: contact.id,
            name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
            email: contact.properties.email,
            title: contact.properties.jobtitle,
            phone: contact.properties.phone,
            lifecycleStage: contact.properties.lifecyclestage || '',
            leadStatus: contact.properties.hs_lead_status || '',
            city: contact.properties.city || '',
            state: contact.properties.state || '',
            country: contact.properties.country || '',
            linkedinBio: contact.properties.linkedinbio || '',
            source: contact.properties.hs_analytics_source || '',
            lastContacted: contact.properties.notes_last_contacted || '',
            nextActivity: contact.properties.notes_next_activity_date || '',
            lastEmailDate: contact.properties.hs_email_last_email_date || '',
            associatedDeals: contact.properties.num_associated_deals || ''
        };

        const companyId = contact.properties.associatedcompanyid;
        const [company, deals] = await Promise.all([
            this.getCompany(orgId, companyId),
            this.getDealsForContact(orgId, contact.id)
        ]);

        if (company) {
            result.company = {
                id: company.id,
                name: company.properties.name,
                domain: company.properties.domain || company.properties.website || '',
                industry: company.properties.industry,
                size: company.properties.numberofemployees,
                description: company.properties.description,
                revenue: company.properties.annualrevenue || '',
                city: company.properties.city || '',
                state: company.properties.state || '',
                country: company.properties.country || '',
                type: company.properties.type || '',
                foundedYear: company.properties.founded_year || ''
            };
        }

        result.deals = deals.map((d) => ({
            id: d.id,
            name: d.properties.dealname,
            stage: d.properties.dealstage,
            amount: d.properties.amount,
            pipeline: d.properties.pipeline,
            closeDate: d.properties.closedate || '',
            description: d.properties.description || '',
            dealType: d.properties.dealtype || '',
            nextStep: d.properties.hs_next_step || '',
            priority: d.properties.hs_priority || ''
        }));

        return result;
    }
}

const service = new HubspotClientService();
service.encrypt = encrypt;
module.exports = service;
