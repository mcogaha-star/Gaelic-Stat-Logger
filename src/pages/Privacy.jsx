import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

export default function Privacy() {
  const { isAuthenticated } = useAuth();
  const backUrl = isAuthenticated ? createPageUrl('Home') : createPageUrl('Login');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Privacy</h1>
          <Link to={backUrl}>
            <Button variant="outline">Back</Button>
          </Link>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4 text-slate-700">
          <p className="text-sm">
            GaeliQ syncs match data to your account so your matches can appear on your own devices. Team
            and player names are stored separately from stat rows in account-private identity tables.
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>Private identity tables: team names, player names, colours, jersey numbers, and squad membership.</li>
            <li>Stat rows: event type, positions, timestamps, private player/team references, and jersey-number fallbacks.</li>
            <li>Not duplicated in stat rows: player names and team names.</li>
            <li>Not sent to server: competition, venue/location.</li>
            <li>This is pseudonymisation, not encryption. Normal users only read their own rows, but database administrators could technically join private refs back to names.</li>
            <li>You can revoke consent in Settings, which stops any further uploads.</li>
          </ul>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4 text-slate-700">
          <p className="text-sm font-semibold text-slate-900">Game Share</p>
          <p className="text-sm">
            Game sharing is separate from private sync. When you intentionally create a game share code, the shared snapshot includes the match data, team names, and player names so another signed-in user can import a full private copy.
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>The recipient imports a separate copy. Their edits do not change your original match.</li>
            <li>Imported copies create new private teams, players, match rows, and stat rows for the recipient account.</li>
            <li>Shared copies are snapshots, not live mirrors.</li>
            <li>Imported copies can be reshared later using their own new game share code.</li>
          </ul>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4 text-slate-700">
          <p className="text-sm font-semibold text-slate-900">Stat Share</p>
          <p className="text-sm">
            Stat share is a separate code-based view. It includes team and player names and is intended to let someone open the stats experience without signing in, but it does not create a local private copy.
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>Stat share opens the report in read-only mode.</li>
            <li>It includes the stat tabs, player profiles, and the Data tab without edit controls.</li>
            <li>It does not give access to Home, Settings, logging, sync, or editing tools.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
