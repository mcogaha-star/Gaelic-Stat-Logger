import React from 'react';
import { Link } from 'react-router-dom';
import { Info, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createPageUrl } from '@/utils';

const DEFINITIONS = [
  ['Possession', 'A team possession continues until the last terminal event for that team: score, missed shot giving the opposition possession, turnover, or half end.'],
  ['Attack', 'A possession becomes an attack once it enters the opposition 45. A possession can only count as one attack.'],
  ['Set Attack', 'A possession with no acting events tagged as counter attack.'],
  ['Counter Attack', 'A possession where all relevant acting events are tagged as counter attack.'],
  ['Counter -> Set', 'A possession that starts as a counter attack and later contains a non-counter acting event.'],
  ['Field Tilt', 'Share of pass and carry actions that finish inside the opposition 45, shown as a percentage share between both teams.'],
  ['Scoring Zone', 'Within a 32m arc from the centre of goal and not beyond a 60 degree angle from the pitch midline.'],
  ['Scoring Zone Entry', 'A pass or carry that starts outside the scoring zone and ends inside it.'],
  ['Progressive Meters', 'Distance reduced to the centre of goal, measured from the action start to end point and clamped at zero or above.'],
  ['Progressive Action', 'A pass or carry that gains at least 10m outside the opposition 45, 5m inside it, or crosses into the opposition 45.'],
  ['Build-Up Speed', 'Time from the start of a possession to the first attack event where that possession becomes an attack.'],
  ['Shot Assist', 'The final completed pass before a shot.'],
  ['Shots Created', 'Currently the same as shot assists: the final completed pass before a shot.'],
  ['Own Kickout Win %', 'Own kickouts won divided by own kickouts taken.'],
  ['Turnover Rate', 'Turnovers lost divided by total ball actions for that player or possessions for team-level defense cards, depending on context.'],
  ['PPDA', 'Opponent completed passes divided by defensive actions, where defensive actions include turnovers won, defensive contacts, and selected defensive fouls.'],
  ['Touches', 'Direct ball involvements, including explicit receipts, while avoiding double-counting a receipt followed immediately by the player’s next same-possession action.'],
];

export default function About() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link to={createPageUrl('Home')}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="text-sm text-slate-500">About</div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
                <Info className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xl font-semibold text-slate-900">Gaelic Stats Logger</div>
                <div className="text-sm text-slate-500">Match analysis and performance tracking</div>
              </div>
            </div>

            <div className="text-sm text-slate-700 space-y-2">
              <p>
                This app is designed to help log match events quickly on a pitch map and export the data for analysis.
              </p>
              <p>
                For privacy information, see the Privacy page.
              </p>
            </div>

            <div className="mt-4">
              <Link to={createPageUrl('Privacy')}>
                <Button variant="outline">Privacy</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <div className="text-xl font-semibold text-slate-900">Definitions</div>
              <div className="text-sm text-slate-500 mt-1">Key metrics and terms used throughout the reporting pages.</div>
            </div>
            <div className="space-y-3">
              {DEFINITIONS.map(([term, meaning]) => (
                <div key={term} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">{term}</div>
                  <div className="text-sm text-slate-600 mt-1">{meaning}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
