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
            Gaelic stats tracker collects statistical event data for research and model tuning. Identifiable data such as
            team and player names are not sent to the server.
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1">
            <li>Stored locally only: team names, player names.</li>
            <li>Sent to server: match date, code (GAA/LGFA), level, event types, positions, timestamps, jersey numbers.</li>
            <li>Not sent to server: competition, venue/location.</li>
            <li>You can revoke consent in Settings, which stops any further uploads.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

