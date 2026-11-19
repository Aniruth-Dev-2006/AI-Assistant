const hubspotClient = require('./hubspot-client');
const cheerio = require('cheerio');

class ResearchService {
    extractProspectName(transcript) {
        if (!transcript || transcript.length === 0) return null;
        const candidateTurn = transcript.find((t) => t.speakerRole === 'candidate');
        if (candidateTurn && candidateTurn.speaker && candidateTurn.speaker !== 'Participant') {
            return candidateTurn.speaker;
        }
        return null;
    }

    domainFromEmail(email) {
        if (!email || !String(email).includes('@')) return '';
        const domain = String(email).split('@')[1].trim().toLowerCase();
        if (!domain) return '';
        if (/^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|protonmail|proton)\./i.test(domain)) {
            return '';
        }
        return domain;
    }

    normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    buildSkipEmails(meeting, extras = {}) {
        const skip = new Set();
        const add = (v) => {
            const e = this.normalizeEmail(v);
            if (e && e.includes('@')) skip.add(e);
        };
        add(meeting && meeting.organizerEmail);
        add(extras.ownerEmail);
        add(extras.calendarEmail);
        add(extras.organizerEmail);
        if (Array.isArray(extras.skipEmails)) extras.skipEmails.forEach(add);
        return skip;
    }

    pickLookupFromMeeting(meeting, extras = {}) {
        const participants = Array.isArray(meeting && meeting.participants) ? meeting.participants : [];
        const skip = this.buildSkipEmails(meeting, extras);

        const guestCandidates = [];
        const seen = new Set();
        for (const p of participants) {
            const email = this.normalizeEmail(p && p.email);
            if (!email || skip.has(email) || seen.has(email)) continue;
            if (p && p.self) {
                skip.add(email);
                continue;
            }
            seen.add(email);
            guestCandidates.push({
                email,
                name: (p && p.name) ? String(p.name).trim() : ''
            });
        }

        if (extras.email) {
            const forced = this.normalizeEmail(extras.email);
            if (forced && !skip.has(forced) && !seen.has(forced)) {
                guestCandidates.unshift({
                    email: forced,
                    name: extras.prospectName || ''
                });
            }
        }

        const primary = guestCandidates[0] || null;
        const prospectName = extras.prospectName
            || (meeting && meeting.candidateName)
            || (primary && primary.name)
            || '';

        return {
            email: primary ? primary.email : '',
            emails: guestCandidates.map((c) => c.email),
            candidates: guestCandidates,
            prospectName: prospectName ? String(prospectName).trim() : '',
            companyDomain: extras.companyDomain || (primary ? this.domainFromEmail(primary.email) : ''),
            skippedEmails: Array.from(skip)
        };
    }

    async scrapeCompanyWebsite(domain) {
        if (!domain) return null;
        try {
            const url = domain.startsWith('http') ? domain : `https://${domain}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'MeetingAI-Research/1.0' },
                redirect: 'follow'
            });
            clearTimeout(timer);
            if (!response.ok) return null;
            const html = await response.text();
            const $ = cheerio.load(html);
            const title = $('title').text() || '';
            const description = $('meta[name="description"]').attr('content') || '';
            const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 500);
            return { title, description, bodyText };
        } catch (e) {
            console.error(`[ResearchService] Scrape failed for ${domain}:`, e.message);
            return null;
        }
    }

    generateSummary(context) {
        const summaryParts = [];

        if (context.contact && context.contact.name) {
            let part = `${context.contact.name}`;
            if (context.contact.title) part += ` (${context.contact.title})`;
            if (context.contact.lifecycleStage) part += ` · ${context.contact.lifecycleStage}`;
            summaryParts.push(part);
        }

        if (context.company && context.company.name) {
            let part = `Company: ${context.company.name}`;
            if (context.company.industry) part += ` - ${context.company.industry}`;
            if (context.company.size) part += ` (${context.company.size} employees)`;
            if (context.company.revenue) part += ` · revenue ${context.company.revenue}`;
            summaryParts.push(part);
        }

        if (context.deals && context.deals.length > 0) {
            const topDeal = context.deals[0];
            let dealLine = `Open Deal: ${topDeal.name} (${topDeal.stage || 'n/a'}, $${topDeal.amount || 'n/a'})`;
            if (topDeal.nextStep) dealLine += ` · next: ${topDeal.nextStep}`;
            summaryParts.push(dealLine);
        }

        if (context.companyScrape) {
            summaryParts.push(`Website context: ${context.companyScrape.description || context.companyScrape.title}`);
        }

        if (summaryParts.length === 0) {
            return 'No research data found.';
        }

        return summaryParts.join(' | ');
    }

    formatForLlm(context) {
        if (!context || !context.matched) return '';
        const lines = [];
        const c = context.contact || {};
        const co = context.company || {};
        if (c.name || c.email) {
            lines.push(`Contact: ${[c.name, c.title, c.email, c.phone].filter(Boolean).join(' · ')}`);
            const loc = [c.city, c.state, c.country].filter(Boolean).join(', ');
            if (c.lifecycleStage || c.leadStatus || loc || c.source) {
                lines.push(`CRM status: ${[c.lifecycleStage, c.leadStatus, loc, c.source ? `source ${c.source}` : ''].filter(Boolean).join(' · ')}`);
            }
            if (c.lastContacted || c.nextActivity || c.lastEmailDate) {
                lines.push(`Engagement: ${[
                    c.lastContacted ? `last contacted ${c.lastContacted}` : '',
                    c.lastEmailDate ? `last email ${c.lastEmailDate}` : '',
                    c.nextActivity ? `next activity ${c.nextActivity}` : ''
                ].filter(Boolean).join(' · ')}`);
            }
            if (c.linkedinBio) lines.push(`LinkedIn bio: ${String(c.linkedinBio).slice(0, 280)}`);
        }
        if (co.name) {
            lines.push(`Company: ${[co.name, co.industry, co.size ? `${co.size} employees` : '', co.revenue ? `revenue ${co.revenue}` : '', co.type, co.domain].filter(Boolean).join(' · ')}`);
            const coLoc = [co.city, co.state, co.country].filter(Boolean).join(', ');
            if (coLoc || co.foundedYear) lines.push(`Company location: ${[coLoc, co.foundedYear ? `founded ${co.foundedYear}` : ''].filter(Boolean).join(' · ')}`);
            if (co.description) lines.push(`Company description: ${String(co.description).slice(0, 400)}`);
        }
        if (Array.isArray(context.deals) && context.deals.length) {
            lines.push('Open deals:');
            for (const d of context.deals.slice(0, 5)) {
                lines.push(`- ${[d.name, d.stage, d.amount != null && d.amount !== '' ? `$${d.amount}` : '', d.priority, d.closeDate ? `close ${d.closeDate}` : '', d.nextStep ? `next: ${d.nextStep}` : '', d.description ? String(d.description).slice(0, 120) : ''].filter(Boolean).join(' · ')}`);
            }
        }
        if (context.companyScrape && (context.companyScrape.description || context.companyScrape.title)) {
            lines.push(`Website: ${context.companyScrape.description || context.companyScrape.title}`);
        }
        return lines.join('\n');
    }

    async research(orgId, opts = {}) {
        const emails = Array.isArray(opts.emails) && opts.emails.length
            ? opts.emails.map((e) => this.normalizeEmail(e)).filter(Boolean)
            : (opts.email ? [this.normalizeEmail(opts.email)] : []);
        const uniqueEmails = [...new Set(emails)];
        const prospectName = opts.prospectName || '';

        console.log(`[ResearchService] Starting research for org ${orgId}: Prospect=${prospectName || ''}, Emails=${uniqueEmails.join(',') || '(none)'}, Domain=${opts.companyDomain || ''}`);

        const result = {
            contact: null,
            company: null,
            deals: [],
            companyScrape: null,
            researchSummary: '',
            fetchedAt: new Date().toISOString(),
            connected: false,
            matched: false,
            lookedUpEmails: uniqueEmails
        };

        if (!orgId) {
            result.researchSummary = 'No organization for research.';
            return result;
        }

        const connected = await hubspotClient.isConnected(orgId).catch(() => false);
        result.connected = connected;

        if (connected) {
            for (const email of uniqueEmails) {
                try {
                    const hsContext = await hubspotClient.getFullContext(orgId, { email, name: '' });
                    if (hsContext && hsContext.contact) {
                        result.contact = hsContext.contact;
                        result.company = hsContext.company;
                        result.deals = hsContext.deals || [];
                        result.matched = true;
                        console.log(`[ResearchService] HubSpot match on ${email}`);
                        break;
                    }
                } catch (e) {
                    console.error(`[ResearchService] HubSpot lookup failed for ${email}:`, e.message);
                }
            }

            if (!result.matched && prospectName) {
                try {
                    const hsContext = await hubspotClient.getFullContext(orgId, { name: prospectName });
                    if (hsContext && hsContext.contact) {
                        result.contact = hsContext.contact;
                        result.company = hsContext.company;
                        result.deals = hsContext.deals || [];
                        result.matched = true;
                        console.log(`[ResearchService] HubSpot match on name ${prospectName}`);
                    }
                } catch (e) {
                    console.error('[ResearchService] HubSpot name lookup failed:', e.message);
                }
            }
        }

        const domain = opts.companyDomain
            || (result.company && result.company.domain)
            || this.domainFromEmail(uniqueEmails[0] || '')
            || (result.contact && result.contact.email && this.domainFromEmail(result.contact.email));

        if (domain) {
            result.companyScrape = await this.scrapeCompanyWebsite(domain);
        }

        result.researchSummary = this.generateSummary(result);
        console.log(`[ResearchService] Research complete. Summary: ${result.researchSummary}`);
        return result;
    }
}

module.exports = new ResearchService();
