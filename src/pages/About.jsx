import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';

const DEFINITIONS = [
  ['Possession', 'A team possession continues until the last terminal event for that team: score, missed shot giving the opposition possession, turnover, or half end.'],
  ['Attack', 'A possession becomes an attack once it enters the opposition 45. A possession can only count as one attack.'],
  ['Set Defence', 'Marks whether the opposition defence was set on that action. `Yes` means the defence was set. `No` means it was not set. Possession and report summaries now collapse this to simple Yes/No reporting.'],
  ['Field Tilt', 'Share of pass and carry actions that finish inside the opposition 45, shown as a percentage share between both teams.'],
  ['Scoring Zone', 'Within a 32m arc from the centre of goal and not beyond a 60 degree angle from the pitch midline.'],
  ['Scoring Zone Entry', 'A pass or carry that starts outside the scoring zone and ends inside it.'],
  ['Progressive Meters', 'Distance reduced to the centre of goal, measured from the action start to end point and clamped at zero or above.'],
  ['Progressive Action', 'A progressive pass finishes more than 20% closer to goal than it started. A progressive carry finishes more than 15% closer to goal than it started.'],
  ['Successful Progressive Passes / Carries', 'Counts completed progressive passes and completed progressive carries. These are shown as event counts rather than completion percentages.'],
  ['Switch', 'A completed pass with more than 30m of change in y-coordinate from start point to end point.'],
  ['Defensive Action', 'At team level this is any turnover forced, any high-pressure opposition carry, and any high-pressure opposition pass or shot. At player level it counts turnovers forced or recovered, without double counting a player who does both on the same turnover, plus high-pressure carry defender actions.'],
  ['Average DA Height', 'Average x-position of a team’s defensive actions. This replaces regain height and reflects where defensive actions happened rather than only where recoveries happened.'],
  ['Passes / Possession Minute', 'Completed and incomplete passes per minute of derived live team possession time. Dead-ball gaps are excluded from the denominator.'],
  ['Build-Up Speed', 'Average time from the live start of an attack possession to the first attacking action inside the opposition 45. Dead-ball gaps are excluded from the timing denominator.'],
  ['Shot Assist', 'The final completed pass before a shot.'],
  ['Shots Created', 'Currently the same as shot assists: the final completed pass before a shot.'],
  ['Possession Start Zone', 'The zone of the first acting event in a possession, grouped as defensive third, middle third, or attacking third.'],
  ['Own Kickout Win %', 'Own kickouts won divided by own kickouts taken.'],
  ['TO Lost / 10 Poss', 'Turnovers lost per 10 possessions. Player tables use possessions where the player recorded a touch. Team defense cards use overall team possessions.'],
  ['PPDA', 'Opponent completed passes divided by team defensive actions.'],
  ['Turnover Forced / Recovered', 'Player defense tables now split turnover involvement into turnovers a player forced and turnovers a player recovered, rather than one combined `TO Won` figure.'],
  ['Private Sync', 'Team and player names sync through account-private identity tables. Stat rows use private IDs and jersey-number fallbacks rather than duplicating names. This is pseudonymisation, not encryption.'],
  ['Shared Match Copy', 'A share code creates a snapshot that another signed-in user can import as a full private copy, including team and player names. The imported copy is separate from the original and gets its own share code.'],
  ['Dispossessed - Retained', 'A carry where the ball carrier is disrupted or dispossessed but the in-possession team recovers the ball. It is not a turnover and does not end the possession.'],
  ['Broken - Retained', 'A pass that is broken up or disrupted, but the passer’s team still recovers it. It is treated as an incomplete pass, not a turnover.'],
  ['Brought Back Advantage In Calculations', 'Rows marked `Brought Back - Adv.` are excluded from stat calculations and player stats. Maps can still display them where relevant as visual context.'],
  ['Touches', 'Times a player gains or takes control of the ball: pass won_by, turnover recovered_by, kickout won_by, throw-in won_by, shot recoveries from short/blocked/saved/post with retained or opposition results, recovered_by on dispossessed-retained or broken-retained actions, and restart takers on deadball pass/carry, solo_plus_go carry, or placed-ball shots.'],
  ['Touch Map', 'Plots the touch events counted by the touch definition for the selected player. It uses the same underlying touch logic as the player touch totals.'],
  ['Pass Sonar', 'Groups passes by starting zone and direction. Wedge length shows relative pass frequency. Wedge colour shows the mix of kickpasses versus handpasses on a red-purple-blue scale.'],
  ['Carry Rate', 'Carries divided by touches.'],
  ['Pass Rate', 'Passes divided by touches.'],
  ['Shoot Rate', 'Shots divided by touches.'],
  ['No-Carry Pass Rate', 'Passes played by a player before they have carried the ball in that same possession, divided by touches.'],
];

const LOGGING_GUIDE = [
  ['Pressure', 'Use `High` when there is contact or tackle pressure. Use `Medium` when a defender is within 3m but there is no contact. Use `Low` when the nearest defender is more than 3m away.'],
  ['Carry Pressure', 'On carries, `High` pressure should include the defender. The defender should be from the opposition team.'],
  ['Defensive Actions In Logging', 'Team defensive actions come from turnovers forced, high-pressure opposition carries, and high-pressure opposition passes or shots. Individual defensive actions come from turnover force/recovery involvement and high-pressure carry defender actions.'],
  ['Pass Accuracy ++', 'Perfectly weighted or in stride. The receiver does not need to adjust. Judge defender positioning, pace, weight, and accuracy of the pass.'],
  ['Pass Accuracy +', 'Standard completed pass. The receiver may make only a minor adjustment. This is the default for newly logged passes.'],
  ['Pass Accuracy -', 'Potentially winnable, but the receiver needs a major adjustment. This can still be a completed pass if the receiver wins it.'],
  ['Pass Accuracy --', 'Very poor or effectively unwinnable pass. Use this when the pass quality, not the difficulty of the situation, is the main problem.'],
  ['Accuracy vs Difficulty', 'Do not increase or decrease the accuracy rating just because the pass was difficult. Rate whether the pass itself gave the receiver a fair chance.'],
  ['Broken - Retained Passes', 'Use `Broken - Retained` when the pass is disrupted or broken, but the passer’s team regains possession. Log the recovering player from the passer’s team.'],
  ['Dispossessed - Retained Carries', 'Use `Dispossessed - Retained` when the carrier is disrupted but the same team recovers the ball. Log the recovering player from the in-possession team.'],
  ['Restart Takers And Touches', 'Deadball pass or carry restarts, solo-plus-go carries, and placed-ball shots all count as touches for the restart taker. Own kickout takers are no longer counted as touches unless they also win the kickout.'],
  ['Set Defence', '`Yes` means the opposition defence was set on that action. `No` means the action happened before the defence was set.'],
  ['Team-Level Fouls', 'For breach, technical, and other team-level fouls, set `Foul By` to `Home Team` or `Away Team` and set `Foul On` to the opposite team.'],
];

const ID_EDIT_GUIDE = [
  ['Open It', 'In the Data tab, expand a row or grouped possession and choose `Edit IDs` to open the guided play and possession editor.'],
  ['Use Scope First', 'Choose `This row only` when one event is wrong, `This row + following rows` when the possession break happens too late, and `Entire current possession` when the whole possession should move together.'],
  ['Move Possessions Safely', 'Use `Move to previous possession`, `Move to next possession`, or `Move to chosen possession` when an event is attached to the wrong possession. Use `Start new possession here` when a new possession should begin at that row.'],
  ['Change Team Carefully', 'Use `Change possession team` when the possession number is correct but the team attribution is wrong.'],
  ['Reorder Plays', 'Use `Move earlier`, `Move later`, `Move before chosen row`, or `Move after chosen row` when the event sequence is wrong. The tool resequences play IDs automatically to keep the order valid.'],
  ['Advanced Raw IDs', 'Only use the advanced raw section when you know the exact play and possession numbers you want. It is more powerful, but easier to misuse than the guided actions.'],
  ['Best Workflow', 'Fix ordering first if the sequence is wrong, then fix possession grouping, then recheck the Possessions and Visualiser views to make sure the cleanup behaved as expected.'],
];

const POSSESSION_LOGIC_GUIDE = [
  ['Keep Starts Narrow', 'Treat possession starts as only coming from clear transition events: `Turnover Won`, `Kickout Won`, `Throw In Won`, or `Shot Short/Blocked/Post/Saved` with `result = opposition`. This keeps the model stable and avoids fuzzy starts like generic fouls or restart carries.'],
  ['Keep Ends Narrow', 'Treat possession ends as only coming from terminal events: score, wide, turnover, half end, or `short/blocked/post/saved + opposition`. Retained shots do not end the possession. Non-turnover fouls do not end the possession.'],
  ['Brought Back Advantage', 'Use `Brought Back - Adv.` on turnover or shot rows only when play is brought back and that event should not start a new possession. It defaults to `No`. When set to `Yes`, the same possession continues across that row.'],
  ['Turnover Rule', 'A `TO` logged directly or inside a pass or carry should end the old possession. The next possession belongs to the team that wins or recovers it. If `Brought Back - Adv.` is set to `Yes`, do not flip possession from that event.'],
  ['Fallback Order', 'When possession ownership is unclear, use this order: explicit winner or recovery data first, explicit foul-by logic second, and only then a next-play fallback. The fallback should be based on who truly has the ball on the next action, not just whichever team appears in the next row summary.'],
  ['Be Careful With Next Play', 'If the next play is itself a turnover, infer the next possession from who lost it and who recovered or won it, rather than blindly using the row team. This matters most after restart fouls or messy rows.'],
  ['Kickout And Throw-In Fouls', 'For kickouts and throw-ins, use the same logic. Sideline-for should behave like a retained restart. Sideline-against should behave like a lost restart. If explicit foul players are present, infer the winner from `foul_by` and `foul_on`. If they are blank, fall back to the next true ball-action team.'],
  ['Manual Fixes Win', 'Once you have manually corrected possession IDs in Data, treat those edits as the authority for that match. Automatic rebuilds should not keep overriding careful manual repairs.'],
  ['Team Foul Entry', 'For breach, technical, and other team-level fouls, set `Foul By` to `Home Team` or `Away Team` and set `Foul On` to the opposite team. That makes scorable free, foul, and restart analytics much more reliable.'],
];

export default function About() {
  const { user, isAuthenticated, linkGoogleIdentity, isSupabaseConfigured } = useAuth();
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const accountLabel = isAuthenticated
    ? (user?.email || user?.phone || user?.id || 'Signed in')
    : 'Not signed in';
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const hasGoogleIdentity = identities.some((identity) => identity?.provider === 'google');

  const handleLinkGoogle = async () => {
    if (!isSupabaseConfigured) {
      toast.error('Account linking is not configured for this deployment.');
      return;
    }
    setIsLinkingGoogle(true);
    try {
      await linkGoogleIdentity();
      toast.message('Opening Google linking...');
    } catch (error) {
      toast.error(error?.message || 'Failed to start Google linking');
      setIsLinkingGoogle(false);
    }
  };

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

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-slate-100 p-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="definitions">Definitions</TabsTrigger>
            <TabsTrigger value="logging">Logging Guide</TabsTrigger>
            <TabsTrigger value="edit-ids">Edit IDs</TabsTrigger>
            <TabsTrigger value="possession">Possession</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
                    <Info className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-slate-900">
                      <span>Gael</span><span className="text-red-600">IQ</span>
                    </div>
                    <div className="text-sm text-slate-500">Match analysis and performance tracking</div>
                  </div>
                </div>

                <div className="text-sm text-slate-700 space-y-2">
                  <p>
                    This app is designed to help log match events quickly on a pitch map and export the data for analysis.
                  </p>
                  <p>
                    Private sync is for your own account across devices. Shared match copies are separate and intentionally include team and player names when you generate a share code for someone else.
                  </p>
                  <p>
                    For privacy and sharing information, see the Privacy page.
                  </p>
                </div>

                <div className="mt-4">
                  <Link to={createPageUrl('Privacy')}>
                    <Button variant="outline">Privacy</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="account" className="mt-0">
            <Card>
              <CardContent className="p-6 space-y-3">
                <div>
                  <div className="text-xl font-semibold text-slate-900">Current Account</div>
                  <div className="text-sm text-slate-500 mt-1">The account currently signed into this app on this device.</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Logged In As</div>
                  <div className="mt-1 text-sm font-medium text-slate-900 break-all">{accountLabel}</div>
                  {isAuthenticated && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant={hasGoogleIdentity ? 'outline' : 'default'}
                        disabled={hasGoogleIdentity || isLinkingGoogle}
                        onClick={handleLinkGoogle}
                      >
                        {hasGoogleIdentity ? 'Google Linked' : 'Link Google Account'}
                      </Button>
                      <div className="text-xs text-slate-500 max-w-md">
                        Link Google to this signed-in account so using Google later opens the same account instead of creating a separate one.
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="definitions" className="mt-0">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <div className="text-xl font-semibold text-slate-900">Definitions</div>
                  <div className="text-sm text-slate-500 mt-1">Automatic calculations and report metrics used throughout the app.</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {DEFINITIONS.map(([term, meaning]) => (
                    <div key={term} className="rounded-xl border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{term}</div>
                      <div className="text-sm text-slate-600 mt-1">{meaning}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logging" className="mt-0">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <div className="text-xl font-semibold text-slate-900">Logging Guide</div>
                  <div className="text-sm text-slate-500 mt-1">How to use subjective logging fields consistently while tagging a match.</div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {LOGGING_GUIDE.map(([term, meaning]) => (
                    <div key={term} className="rounded-xl border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{term}</div>
                      <div className="text-sm text-slate-600 mt-1">{meaning}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="edit-ids" className="mt-0">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <div className="text-xl font-semibold text-slate-900">Edit IDs Guide</div>
                  <div className="text-sm text-slate-500 mt-1">How to fix play order and possession grouping safely in the Data tab.</div>
                </div>
                <div className="space-y-3">
                  {ID_EDIT_GUIDE.map(([term, meaning]) => (
                    <div key={term} className="rounded-xl border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{term}</div>
                      <div className="text-sm text-slate-600 mt-1">{meaning}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="possession" className="mt-0">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <div className="text-xl font-semibold text-slate-900">Possession Logic Guide</div>
                  <div className="text-sm text-slate-500 mt-1">Practical rules for tagging possession starts, ends, advantage, and fallback inference safely.</div>
                </div>
                <div className="space-y-3">
                  {POSSESSION_LOGIC_GUIDE.map(([term, meaning]) => (
                    <div key={term} className="rounded-xl border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{term}</div>
                      <div className="text-sm text-slate-600 mt-1">{meaning}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
