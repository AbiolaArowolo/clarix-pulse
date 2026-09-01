import React, { useEffect, useState } from 'react';
import type { TenantRole } from '../features/auth/AuthProvider';
import { copyTextToClipboard } from '../lib/clipboard';

type InvitableRole = 'admin' | 'user' | 'support';

interface Teammate {
  userId: string;
  email: string;
  displayName: string;
  role: TenantRole;
  status: 'active' | 'pending';
  createdAt: string;
  updatedAt: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

const ROLE_LABEL: Record<InvitableRole, string> = {
  admin: 'Admin',
  user: 'User',
  support: 'Support',
};

const ROLE_HINT: Record<InvitableRole, string> = {
  admin: 'Can invite/remove teammates and manage workspace settings.',
  user: 'Regular operational read/write access.',
  support: 'Full access except delete operations.',
};

// This entire panel is admin-only (design requirement) -- AccountPage only
// mounts it when currentUserRole is 'admin' or a platform admin
// ('super_admin'), but the check is repeated here too so this component is
// safe to render from anywhere without silently exposing team management.
function canManageTeam(role: TenantRole): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function TeammatesPanel({
  currentUserId,
  currentUserRole,
}: {
  currentUserId: string;
  currentUserRole: TenantRole;
}) {
  const [members, setMembers] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableRole>('user');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ url: string; emailSent: boolean } | null>(null);

  const canManage = canManageTeam(currentUserRole);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/team/members');
      const payload = await readJsonResponse<{ members?: Teammate[]; error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load teammates.');
      }
      setMembers(payload.members ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teammates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const sendInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setInviteLink(null);

    const email = inviteEmail.trim();
    if (!email) {
      setError('An email address is required to invite a teammate.');
      return;
    }

    setInviting(true);
    try {
      const response = await fetch('/api/team/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName: inviteDisplayName.trim(),
          role: inviteRole,
        }),
      });
      const payload = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        signUpUrl?: string;
        email?: { sent?: boolean };
      }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to invite that teammate.');
      }

      const emailSent = Boolean(payload.email?.sent);
      setNotice(
        emailSent
          ? `Invite sent to ${email}.`
          : `Invite created for ${email}. Email delivery isn't configured on this server -- copy the sign-up link below and send it yourself.`,
      );
      if (payload.signUpUrl) {
        setInviteLink({ url: payload.signUpUrl, emailSent });
      }
      setInviteEmail('');
      setInviteDisplayName('');
      setInviteRole('user');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite that teammate.');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await copyTextToClipboard(inviteLink.url);
      setNotice('Sign-up link copied.');
    } catch {
      setNotice('Copy failed. Select the link and copy it manually.');
    }
  };

  const changeRole = async (userId: string, role: InvitableRole) => {
    resetFeedback();
    setPendingUserId(userId);
    try {
      const response = await fetch(`/api/team/members/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to update that teammate\'s role.');
      }
      setNotice('Role updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update that teammate\'s role.');
    } finally {
      setPendingUserId(null);
    }
  };

  const revokeInvite = async (member: Teammate) => {
    const confirmed = window.confirm(`Revoke the pending invite for ${member.email}?`);
    if (!confirmed) return;

    resetFeedback();
    setPendingUserId(member.userId);
    try {
      const response = await fetch(`/api/team/invites/${encodeURIComponent(member.userId)}`, {
        method: 'DELETE',
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to revoke that invite.');
      }
      setNotice(`Invite revoked for ${member.email}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke that invite.');
    } finally {
      setPendingUserId(null);
    }
  };

  const removeMember = async (member: Teammate) => {
    const confirmed = window.confirm(`Remove ${member.email} from this workspace? They will lose access immediately.`);
    if (!confirmed) return;

    resetFeedback();
    setPendingUserId(member.userId);
    try {
      const response = await fetch(`/api/team/members/${encodeURIComponent(member.userId)}`, {
        method: 'DELETE',
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to remove that teammate.');
      }
      setNotice(`Removed ${member.email} from the workspace.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove that teammate.');
    } finally {
      setPendingUserId(null);
    }
  };

  // Non-admins (including 'support') never see team management at all --
  // this mirrors the backend, which rejects these calls outright for them.
  if (!canManage) {
    return null;
  }

  return (
    <section className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5 sm:px-6 sm:py-6">
      <p className="ui-kicker-muted">Teammates</p>
      <h3 className="mt-3 text-2xl font-semibold text-slate-50">Invite and manage workspace access</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
        Admins can invite teammates, change their role, or remove them. Support accounts have full read/write access
        but cannot perform delete operations; only admins can manage the roster itself.
      </p>

      {notice && (
        <div className="mt-4 rounded-[var(--radius-control)] border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <form onSubmit={sendInvite} className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-end">
        <label className="block">
          <span className="text-sm text-slate-300">Email</span>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="teammate@company.com"
            className="mt-2 w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-950/90 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Name (optional)</span>
          <input
            type="text"
            value={inviteDisplayName}
            onChange={(event) => setInviteDisplayName(event.target.value)}
            placeholder="Jane Doe"
            className="mt-2 w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-950/90 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Role</span>
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as InvitableRole)}
            className="mt-2 w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-950/90 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
          >
            {(Object.keys(ROLE_LABEL) as InvitableRole[]).map((role) => (
              <option key={role} value={role}>{ROLE_LABEL[role]}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={inviting}
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-indigo-400/35 bg-indigo-400/14 px-5 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {inviting ? 'Sending invite...' : 'Send invite'}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">{ROLE_HINT[inviteRole]}</p>

      {inviteLink && (
        <div className="mt-4 rounded-[var(--radius-panel)] border border-slate-800/80 bg-slate-950/55 p-4">
          <p className="ui-kicker-muted">Sign-up link</p>
          <div className="mt-2 rounded-[var(--radius-control)] border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-indigo-100 break-all whitespace-normal">
            {inviteLink.url}
          </div>
          <button
            type="button"
            onClick={() => void copyInviteLink()}
            className="mt-3 rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300"
          >
            Copy link
          </button>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400">Loading teammates...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-400">No teammates yet.</p>
        ) : (
          members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const pending = pendingUserId === member.userId;
            const isPending = member.status === 'pending';
            return (
              <div
                key={member.userId}
                className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/45 px-4 py-4"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {member.displayName || member.email}
                      {isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">{member.email}</p>
                    <p className="mt-1 text-xs">
                      <span className={isPending ? 'text-amber-300' : 'text-emerald-300'}>
                        {isPending ? 'Invite pending' : 'Active'}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <select
                      value={member.role === 'super_admin' ? 'admin' : member.role}
                      disabled={isSelf || pending || member.role === 'super_admin'}
                      onChange={(event) => void changeRole(member.userId, event.target.value as InvitableRole)}
                      className="rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {(Object.keys(ROLE_LABEL) as InvitableRole[]).map((role) => (
                        <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                      ))}
                    </select>

                    {isPending ? (
                      <button
                        type="button"
                        onClick={() => void revokeInvite(member)}
                        disabled={pending}
                        className="inline-flex min-h-9 items-center justify-center rounded-full border border-red-500/35 bg-red-500/12 px-4 py-1.5 text-xs font-semibold text-red-50 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pending ? 'Working...' : 'Revoke invite'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void removeMember(member)}
                        disabled={isSelf || pending}
                        className="inline-flex min-h-9 items-center justify-center rounded-full border border-red-500/35 bg-red-500/12 px-4 py-1.5 text-xs font-semibold text-red-50 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pending ? 'Working...' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
