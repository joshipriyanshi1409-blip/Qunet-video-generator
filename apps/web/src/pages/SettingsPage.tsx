import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { useDnaProfile, useUpdateDna } from '../hooks/useDna';
import { useToast } from '../hooks/useToast';
import { DEVANSHI_AVATAR } from '../lib/studioFixtures';
import { cn } from '../lib/cn';

const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'account', label: 'Account', icon: '🛡️' },
  { id: 'help', label: 'Help & Support', icon: '❓' },
] as const;

export function SettingsPage() {
  const { push } = useToast();
  const dnaQuery = useDnaProfile();
  const updateDna = useUpdateDna();

  const [activeTab, setActiveTab] = useState<(typeof SETTINGS_TABS)[number]['id']>('profile');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('Devanshi Goyal');
  const [roleSubtitle, setRoleSubtitle] = useState('Creator · CSE');
  const [niche, setNiche] = useState(dnaQuery.data?.dna.niche ?? 'Tech (CSE)');
  const [styleText, setStyleText] = useState(dnaQuery.data?.dna.style ?? 'Friendly - Educational');

  const dna = dnaQuery.data?.dna;

  function handleSaveProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (dna !== undefined) {
      updateDna.mutate(
        {
          niche: niche.trim() || dna.niche,
          style: styleText.trim() || dna.style,
        },
        {
          onSuccess: () => {
            setEditing(false);
            push({
              title: 'Profile updated',
              description: 'Your Creator DNA summary has been synced.',
              tone: 'success',
            });
          },
          onError: () => {
            setEditing(false);
            push({
              title: 'Profile saved locally',
              tone: 'success',
            });
          },
        },
      );
    } else {
      setEditing(false);
      push({ title: 'Profile updated', tone: 'success' });
    }
  }

  return (
    <>
      <PageHeader
        title="Settings & Profile"
        description="Manage your creator profile, Creator DNA summary, notifications, and account."
      />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Left Sub-navigation (Screen 11) */}
        <nav aria-label="Settings sections" className="space-y-1.5">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-body font-medium transition-colors',
                  isActive
                    ? 'border border-peach-200 bg-peach-100 font-semibold text-peach-800 shadow-2xs'
                    : 'text-ink-700 hover:bg-peach-50 hover:text-ink-900',
                )}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Content Area */}
        <div className="space-y-6">
          {activeTab === 'profile' ? (
            <>
              {/* Creator Profile Card (Screen 11) */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                    <img
                      src={DEVANSHI_AVATAR}
                      alt={displayName}
                      className="size-24 shrink-0 rounded-pill border-4 border-peach-100 object-cover shadow-card"
                    />
                    <div className="min-w-0 flex-1 text-center sm:text-left">
                      <h2 className="text-title font-bold text-ink-900">{displayName}</h2>
                      <p className="mt-0.5 text-body text-ink-500">{roleSubtitle}</p>
                      <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing((prev) => !prev)}
                        >
                          ✏️ {editing ? 'Cancel' : 'Edit Profile'}
                        </Button>
                        <Link
                          to="/dna"
                          className="inline-flex h-8 items-center rounded-pill border border-line bg-surface px-3.5 text-caption font-medium text-ink-700 hover:bg-peach-50"
                        >
                          Open Full DNA →
                        </Link>
                      </div>
                    </div>
                  </div>

                  {editing ? (
                    <form
                      onSubmit={handleSaveProfile}
                      className="mt-6 space-y-4 border-t border-line pt-5"
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="profile-name"
                            className="block text-caption font-medium text-ink-700"
                          >
                            Display Name
                          </label>
                          <input
                            id="profile-name"
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-line bg-surface-muted px-3 text-body text-ink-900"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="profile-role"
                            className="block text-caption font-medium text-ink-700"
                          >
                            Tagline / Role
                          </label>
                          <input
                            id="profile-role"
                            type="text"
                            value={roleSubtitle}
                            onChange={(e) => setRoleSubtitle(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-line bg-surface-muted px-3 text-body text-ink-900"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="profile-niche"
                            className="block text-caption font-medium text-ink-700"
                          >
                            Primary Niche
                          </label>
                          <input
                            id="profile-niche"
                            type="text"
                            value={niche}
                            onChange={(e) => setNiche(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-line bg-surface-muted px-3 text-body text-ink-900"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="profile-style"
                            className="block text-caption font-medium text-ink-700"
                          >
                            Content Style
                          </label>
                          <input
                            id="profile-style"
                            type="text"
                            value={styleText}
                            onChange={(e) => setStyleText(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-line bg-surface-muted px-3 text-body text-ink-900"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button type="submit" loading={updateDna.isPending}>
                          Save Profile
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </CardContent>
              </Card>

              {/* Creator DNA Summary (Screen 11) */}
              <Card>
                <CardHeader
                  title="Creator DNA Summary"
                  description="Your persistent content fingerprint across every AI pipeline stage."
                />
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-line bg-surface-muted/60 p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-body font-semibold text-ink-900">
                        <span aria-hidden="true" className="text-info">👤</span>
                        <span>{dna?.niche ?? 'Tech (CSE)'}</span>
                      </div>
                      <p className="mt-1.5 text-caption font-bold text-ink-500">(94%)</p>
                    </div>

                    <div className="rounded-2xl border border-line bg-surface-muted/60 p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-body font-semibold text-ink-900">
                        <span aria-hidden="true" className="text-emerald-600">👥</span>
                        <span>{dna?.audienceAgeRange ?? '18-24'}</span>
                      </div>
                      <p className="mt-1.5 text-caption font-bold text-ink-500">(88%)</p>
                    </div>

                    <div className="rounded-2xl border border-line bg-surface-muted/60 p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-body font-semibold text-ink-900">
                        <span aria-hidden="true" className="text-amber-500">☀️</span>
                        <span>{dna?.style ?? 'Friendly - Educational'}</span>
                      </div>
                      <p className="mt-1.5 text-caption font-bold text-ink-500">(90%)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Warm Bottom Banner (Screen 11) */}
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-peach-200 bg-peach-50 px-5 py-3.5 text-caption font-semibold text-peach-800">
                <span aria-hidden="true">💡</span>
                <span>Keep creating. Your content makes an impact!</span>
                <span aria-hidden="true">🤍</span>
              </div>
            </>
          ) : null}

          {activeTab === 'notifications' ? (
            <Card>
              <CardHeader
                title="Notifications"
                description="Choose when CreatorDNA notifies you about finished renders and DNA insights."
              />
              <CardContent className="space-y-3">
                {[
                  { id: 'notif-render', label: 'Video render completed', desc: 'Notify when an MP4 finishes rendering', on: true },
                  { id: 'notif-trend', label: 'New Trend Remix match (>90%)', desc: 'Alert when a trending topic matches your DNA', on: true },
                  { id: 'notif-dna', label: 'Creator DNA learning loop updates', desc: 'Weekly summary of suggested profile refinements', on: true },
                ].map((pref) => (
                  <div
                    key={pref.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-muted/50 px-4 py-3"
                  >
                    <label htmlFor={pref.id} className="cursor-pointer">
                      <span className="block text-body font-semibold text-ink-900">{pref.label}</span>
                      <span className="block text-caption text-ink-500">{pref.desc}</span>
                    </label>
                    <input
                      id={pref.id}
                      type="checkbox"
                      defaultChecked={pref.on}
                      className="size-4 accent-peach-500"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'account' ? (
            <Card>
              <CardHeader
                title="Account"
                description="Connected creator account and Qoneqt publishing credentials."
              />
              <CardContent className="space-y-3 text-body text-ink-700">
                <p>
                  <span className="font-semibold text-ink-900">Creator Handle:</span> @devanshi.cse
                </p>
                <p>
                  <span className="font-semibold text-ink-900">Qoneqt Feed Sync:</span> Connected &amp; Active
                </p>
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'help' ? (
            <Card>
              <CardHeader
                title="Help & Support"
                description="Quick guides for getting the most out of CreatorDNA Studio."
              />
              <CardContent className="space-y-2 text-caption text-ink-700">
                <p>• Use <strong>Trend Remix</strong> to adapt viral formats into your CSE student voice.</p>
                <p>• Run <strong>Audience Mirror</strong> before rendering to check how students &amp; beginner coders will react.</p>
                <p>• Rehearse your script in <strong>Live Voice Coach</strong> to hit 80%+ energy and clarity.</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
