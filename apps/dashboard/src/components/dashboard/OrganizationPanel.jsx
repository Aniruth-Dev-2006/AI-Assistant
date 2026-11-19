import React, { useEffect, useState } from 'react';
import { Building2, Copy, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { setSession } from '../../lib/auth';

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 8,
  border: '1px solid var(--border-light)',
  background: 'var(--bg-main)',
  color: 'var(--text-main)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box'
};

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 8,
  color: 'var(--text-main)'
};

const sectionHeader = (title, subtitle) => (
  <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-light)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Building2 size={18} color="var(--text-main)" />
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>{title}</h3>
    </div>
    {subtitle ? (
      <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{subtitle}</p>
    ) : null}
  </div>
);

function RoleBadge({ role }) {
  const colors = {
    owner: { bg: '#EEF2FF', color: '#3730A3' },
    admin: { bg: '#ECFDF5', color: '#047857' },
    member: { bg: 'var(--bg-muted)', color: 'var(--text-muted)' }
  };
  const c = colors[role] || colors.member;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      padding: '3px 8px',
      borderRadius: 999,
      background: c.bg,
      color: c.color
    }}>
      {role}
    </span>
  );
}

export default function OrganizationPanel() {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [membership, setMembership] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [orgName, setOrgName] = useState('');
  const [createName, setCreateName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [acceptToken, setAcceptToken] = useState('');
  const [hint, setHint] = useState('');
  const [salesFlag, setSalesFlag] = useState(false);

  const canManage = membership && (membership.role === 'owner' || membership.role === 'admin');
  const isOwner = membership?.role === 'owner';

  const flash = (msg) => {
    setHint(msg);
    setTimeout(() => setHint(''), 2800);
  };

  const load = async () => {
    setLoading(true);
    try {
      const me = await api.getOrganization();
      setOrg(me.organization || null);
      setMembership(me.membership || null);
      setOrgName(me.organization?.name || '');
      setSalesFlag(!!me.organization?.featureFlags?.includes('salesMode'));

      if (me.organization) {
        const mem = await api.getOrganizationMembers();
        setMembers(mem.members || []);
        if (me.membership?.role === 'owner' || me.membership?.role === 'admin') {
          try {
            const inv = await api.getOrganizationInvites();
            setInvites(inv.invites || []);
          } catch {
            setInvites([]);
          }
        } else {
          setInvites([]);
        }
      } else {
        setMembers([]);
        setInvites([]);
      }
    } catch (e) {
      flash(e.message || 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const applyToken = (token) => {
    if (token) setSession({ authToken: token });
  };

  const createOrg = async () => {
    try {
      const res = await api.createOrganization({ name: createName.trim() });
      applyToken(res.token);
      flash('Workspace created');
      setCreateName('');
      await load();
    } catch (e) {
      flash(e.message || 'Create failed');
    }
  };

  const saveOrg = async () => {
    try {
      const res = await api.updateOrganization({ name: orgName.trim() });
      setOrg(res.organization);
      flash('Organization updated');
    } catch (e) {
      flash(e.message || 'Update failed');
    }
  };

  const sendInvite = async () => {
    try {
      const res = await api.createOrganizationInvite({ email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      flash('Invite created — share the token with your teammate');
      setInvites((prev) => [res.invite, ...prev]);
    } catch (e) {
      flash(e.message || 'Invite failed');
    }
  };

  const revokeInvite = async (id) => {
    try {
      await api.revokeOrganizationInvite(id);
      setInvites((prev) => prev.filter((i) => i.id !== id));
      flash('Invite revoked');
    } catch (e) {
      flash(e.message || 'Revoke failed');
    }
  };

  const copyToken = async (token) => {
    try {
      await navigator.clipboard.writeText(token);
      flash('Invite token copied');
    } catch {
      flash(token);
    }
  };

  const acceptInvite = async () => {
    try {
      const res = await api.acceptOrganizationInvite(acceptToken.trim());
      applyToken(res.token);
      setAcceptToken('');
      flash('Joined organization');
      await load();
    } catch (e) {
      flash(e.message || 'Accept failed');
    }
  };

  const changeRole = async (userId, role) => {
    try {
      await api.updateOrganizationMember(userId, { role });
      await load();
      flash('Role updated');
    } catch (e) {
      flash(e.message || 'Role update failed');
    }
  };

  const removeMember = async (userId) => {
    if (!window.confirm('Remove this member from the organization?')) return;
    try {
      await api.removeOrganizationMember(userId);
      await load();
      flash('Member removed');
    } catch (e) {
      flash(e.message || 'Remove failed');
    }
  };

  const toggleSalesFlag = async () => {
    try {
      const next = !salesFlag;
      const res = await api.setOrganizationFeatureFlag('salesMode', next);
      setOrg(res.organization);
      setSalesFlag(next);
      flash(next ? 'Sales Mode enabled for org' : 'Sales Mode disabled for org');
    } catch (e) {
      flash(e.message || 'Flag update failed');
    }
  };

  if (loading) {
    return (
      <>
        {sectionHeader('Organization', 'Workspace, members, and invites.')}
        <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
      </>
    );
  }

  if (!org) {
    return (
      <>
        {sectionHeader('Organization', 'Create a workspace or accept an invite to continue.')}
        <div style={{ padding: '32px 40px', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <label style={labelStyle}>Create workspace</label>
            <input
              style={inputStyle}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Acme Hiring"
            />
            <button
              type="button"
              onClick={createOrg}
              disabled={!createName.trim()}
              style={{
                marginTop: 12,
                padding: '10px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#0B5CFF',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: createName.trim() ? 'pointer' : 'not-allowed',
                opacity: createName.trim() ? 1 : 0.6
              }}
            >
              Create organization
            </button>
          </div>

          <div>
            <label style={labelStyle}>Accept invite token</label>
            <input
              style={inputStyle}
              value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              placeholder="Paste invite token"
            />
            <button
              type="button"
              onClick={acceptInvite}
              disabled={!acceptToken.trim()}
              style={{
                marginTop: 12,
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                background: 'var(--bg-main)',
                color: 'var(--text-main)',
                fontWeight: 600,
                fontSize: 13,
                cursor: acceptToken.trim() ? 'pointer' : 'not-allowed'
              }}
            >
              Join organization
            </button>
          </div>
          {hint ? <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{hint}</p> : null}
        </div>
      </>
    );
  }

  return (
    <>
      {sectionHeader('Organization', 'Manage your workspace, teammates, and feature access.')}
      <div style={{ padding: '32px 40px', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div>
          <label style={labelStyle}>Workspace name</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={!canManage}
            />
            {canManage ? (
              <button
                type="button"
                onClick={saveOrg}
                style={{
                  padding: '0 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0B5CFF',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Save
              </button>
            ) : null}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Plan: <strong style={{ color: 'var(--text-main)' }}>{org.plan}</strong></span>
            <RoleBadge role={membership?.role || 'member'} />
          </div>
        </div>

        {isOwner ? (
          <div style={{
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid var(--border-light)',
            background: 'var(--bg-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>Sales Mode (org flag)</div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', maxWidth: 420 }}>
                Enables the Sales Mode settings page and knowledge base for everyone in this organization.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleSalesFlag}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: salesFlag ? '#0B5CFF' : 'var(--border-light)',
                position: 'relative', flexShrink: 0
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3, left: salesFlag ? 23 : 3,
                transition: 'left 0.2s'
              }} />
            </button>
          </div>
        ) : null}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Members</label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{members.length}</span>
          </div>
          <div style={{ border: '1px solid var(--border-light)', borderRadius: 12, overflow: 'hidden' }}>
            {members.map((m, idx) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderTop: idx ? '1px solid var(--border-light)' : 'none',
                  background: 'var(--bg-main)'
                }}
              >
                <img
                  src={m.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.displayName || m.email)}&background=0D8ABC&color=fff&size=64`}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{m.displayName || m.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                <RoleBadge role={m.role} />
                {canManage && m.role !== 'owner' && m.id !== membership?.userId ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value)}
                      style={{ ...inputStyle, width: 'auto', padding: '6px 8px', fontSize: 12 }}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeMember(m.id)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {canManage ? (
          <div>
            <label style={labelStyle}>Invite teammate</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ ...inputStyle, width: 120 }}
              >
                <option value="member">Member</option>
                {isOwner ? <option value="admin">Admin</option> : null}
              </select>
              <button
                type="button"
                onClick={sendInvite}
                disabled={!inviteEmail.trim()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0B5CFF',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: inviteEmail.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                <UserPlus size={14} /> Invite
              </button>
            </div>

            {invites.length ? (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border-light)',
                      background: 'var(--bg-muted)'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{inv.email}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.token}
                      </div>
                    </div>
                    <RoleBadge role={inv.role} />
                    <button type="button" onClick={() => copyToken(inv.token)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <Copy size={14} />
                    </button>
                    <button type="button" onClick={() => revokeInvite(inv.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label style={labelStyle}>Have an invite token?</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              placeholder="Paste invite token"
            />
            <button
              type="button"
              onClick={acceptInvite}
              disabled={!acceptToken.trim()}
              style={{
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                background: 'var(--bg-main)',
                color: 'var(--text-main)',
                fontWeight: 600,
                fontSize: 13,
                cursor: acceptToken.trim() ? 'pointer' : 'not-allowed'
              }}
            >
              Accept
            </button>
          </div>
        </div>

        {hint ? <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{hint}</p> : null}
      </div>
    </>
  );
}
