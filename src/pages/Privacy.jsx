import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Privacy</h1>
          <Link to={createPageUrl('Home')}>
            <Button variant="outline">Back</Button>
          </Link>
        </div>

        <div className="bg-white border rounded-xl p-6 space-y-4 text-slate-700">
          <p className="text-sm">
            Gaelic Stats Logger syncs match data to your account so your matches can appear on your own devices. Team
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
      </div>
    </div>
  );
}
