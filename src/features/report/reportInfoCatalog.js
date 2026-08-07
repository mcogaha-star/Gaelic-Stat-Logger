export const reportInfoCatalog = {
  overview_momentum: {
    title: 'Momentum',
    whatItIs: [
      'Momentum is a live picture of which team has had the stronger run of play in the most recent stretch of the match.',
    ],
    whyItMatters: [
      'It helps you spot swings in control quickly instead of relying on the scoreboard alone.',
      'A team can be behind on the board but still have the momentum if they are creating the better phase of play.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'This chart uses the latest five minutes of match actions and weights the newest moments the most heavily.',
      'The line moves toward one team when the recent balance of scoring actions and possession outcomes favors them.',
      'The shaded areas show which side the swing belongs to at each point in time.',
    ],
    howToUse: [
      'Use it to find turning points, strong patches, or dips before and after key scores, kickouts, or substitutions.',
    ],
    caveats: [
      'Momentum is form-based, not a final verdict on performance.',
      'Because it is deliberately recent-weighted, it can change quickly after short bursts of action.',
    ],
  },
  overview_possession_outcomes: {
    title: 'Possession Outcomes',
    whatItIs: [
      'This shows how each team finished their possessions, for example with a score, a missed shot, or a turnover.',
    ],
    whyItMatters: [
      'It gives a simple read on end product and care of the ball.',
      'Two teams can have similar possession counts but very different outcomes.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Each bar stacks the logged possession endings for that team inside the current filters.',
      'Clickable outcomes open the underlying possessions behind that result.',
    ],
    howToUse: [
      'Compare whether a team is turning possessions into shots and scores, or wasting too many with turnovers.',
    ],
    caveats: [
      'It describes the finish of the possession, not the full quality of everything that happened inside it.',
    ],
  },
  shooting_metrics: {
    title: 'Shooting Metrics',
    whatItIs: [
      'This block sums up shot quality and shot return, not just raw scores.',
      'The most useful numbers here are xP, xP per shot, points per shot, and low pressure shots.',
    ],
    whyItMatters: [
      'It helps separate good shot creation from hot or cold finishing.',
      'Low pressure shots usually tell you whether a team is earning cleaner looks.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'xP is the expected points total from the logged shots in the filter.',
      'xP per shot is average expected value per attempt.',
      'Points per shot is actual points scored divided by shots taken.',
      'Low pressure shots are attempts logged without heavy defensive pressure.',
    ],
    howToUse: [
      'Use xP and xP per shot to judge chance quality, then compare them with actual output.',
      'Use points per shot to see whether a team is finishing above or below the quality of looks they earned.',
    ],
    caveats: [
      'A small number of shots can swing these numbers quickly.',
      'xP depends on the quality of the shot details that were logged.',
    ],
  },
  shooting_pressure_conversion: {
    title: 'Pressure vs Conversion',
    whatItIs: [
      'This compares finishing by pressure level so you can see how well a team scores when looks are cleaner or harder.',
    ],
    whyItMatters: [
      'It shows whether pressure is really affecting conversion and whether a team is creating enough uncontested chances.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Shots are grouped by the pressure tag logged on each attempt.',
      'The chart then shows how often those shots were converted inside each pressure group.',
    ],
    howToUse: [
      'Look for teams that finish well even under pressure, or teams that still underperform despite getting clean shots.',
    ],
    caveats: [
      'Pressure labels come from the log, so the chart depends on consistent tagging.',
    ],
  },
  shooting_win_probability: {
    title: 'xP Win Probability',
    whatItIs: [
      'This is an estimate of how likely each result was based on the chances both teams created and the score state at the time.',
    ],
    whyItMatters: [
      'It gives context beyond the raw scoreboard, especially when one side is creating the better chances without yet turning that into scores.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The app re-simulates the logged chances many times and asks how often each team would win, draw, or lose from those chances.',
      'The quality, type, and timing of the chances matter, so it is closer to a chance-based result forecast than a scoreboard-only forecast.',
    ],
    howToUse: [
      'Use it to judge whether the match state reflected the balance of chances, or whether finishing and chance prevention changed the likely result.',
    ],
    caveats: [
      'It is still an estimate, not a certainty.',
      'Late goals, very small shot samples, or unusual shooting patterns can change it sharply.',
    ],
  },
  possessions_metrics: {
    title: 'Possession Metrics',
    whatItIs: [
      'These numbers describe how often each team had the ball, how long possessions lasted, and what they produced from them.',
    ],
    whyItMatters: [
      'They help explain game control, attacking style, and efficiency from each possession.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Possession and attack counts come from the current possession grouping in the report.',
      'Points per possession, possession-to-shot rate, and transition attack rate are all based on those grouped possessions within the active filters.',
    ],
    howToUse: [
      'Use this card to compare volume, tempo, and return together instead of looking at one possession number in isolation.',
    ],
    caveats: [
      'The exact totals can change with filters, especially half, time range, and team filters.',
    ],
  },
  possessions_flow: {
    title: 'Possession Flow',
    whatItIs: [
      'This breaks possessions into where they started and how they finished.',
    ],
    whyItMatters: [
      'It shows whether a team is creating good attacks from certain starts, or leaking bad outcomes from certain situations.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'In chart mode, the bars group possession sources and outcomes for the current filters.',
      'In mapping mode, the flow view links those stages together so you can see the most common pathways.',
    ],
    howToUse: [
      'Use it to find the starts that create the best attacks, and the starts that most often break down.',
    ],
    caveats: [
      'This is a structure view of possessions, not a full replay of every action inside them.',
    ],
  },
  possessions_value: {
    title: 'Possession Value',
    whatItIs: [
      'Possession value looks at how productive different possession groups were, not just how often they happened.',
    ],
    whyItMatters: [
      'It helps show which types of possessions were actually worth the most in points or expected points.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Possessions are grouped by the selected split such as start zone, source, length, or attack type.',
      'For each group, the app shows possession count, expected points per possession, and actual points per possession.',
    ],
    howToUse: [
      'Use it to compare efficient possession types with less productive ones and decide what style is really paying off.',
    ],
    caveats: [
      'A small but very successful group can rate highly even if it was not used often.',
    ],
  },
  build_up_metrics: {
    title: 'Build-Up Metrics',
    whatItIs: [
      'These top-line numbers describe how a team moves the ball forward before the final attacking phase.',
    ],
    whyItMatters: [
      'They show whether a team is advancing with passing, carrying, progressive actions, or field position rather than just counting final outcomes.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'This card combines completion numbers, progressive actions, switches, and field tilt inside the active filters.',
      'Field tilt shows how much of the attacking-territory ball use belonged to each team.',
    ],
    howToUse: [
      'Use it to compare how cleanly and how aggressively each side built attacks.',
    ],
    caveats: [
      'It describes build-up habits, not whether the final shot was taken well.',
    ],
  },
  build_up_style: {
    title: 'Build-Up Style',
    whatItIs: [
      'This card focuses on how a team builds, rather than how often it simply keeps the ball.',
    ],
    whyItMatters: [
      'It helps separate direct, quick build-up from slower, more patient build-up.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The metrics combine build-up speed, entries into the scoring zone, pass volume in possession, average pass length, and handpass-to-kickpass balance.',
    ],
    howToUse: [
      'Read it alongside the maps and sonars to decide whether a team is getting forward through speed, width, longer kicking, or patient recycling.',
    ],
    caveats: [
      'A team can look neat in build-up style numbers but still lack end product later in the attack.',
    ],
  },
  build_up_sonars: {
    title: 'Pass Sonars',
    whatItIs: [
      'Pass sonars show the directions a team played the ball most often from different parts of the pitch.',
    ],
    whyItMatters: [
      'They quickly reveal whether a team tends to play forward, inside, wide, or backwards from each zone.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Each wedge represents a direction band.',
      'Larger wedges mean more passes in that direction, and the color mix shows the handpass or kickpass balance.',
    ],
    howToUse: [
      'Use the sonars to spot repeating build-up patterns and whether they change by pitch zone.',
    ],
    caveats: [
      'Sonars show direction and mix, not whether the pass broke lines or created a shot.',
    ],
  },
  build_up_pass_network: {
    title: 'Pass Network',
    whatItIs: [
      'This map shows the most repeated completed passing links for the selected team.',
    ],
    whyItMatters: [
      'It helps you see whether build-up flows through a few hubs, wide links, or a broader group.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Nodes represent players and links represent repeated completed passing connections.',
      'The network only includes completed passes that match the current filters and minimum-link setting.',
    ],
    howToUse: [
      'Use the map to spot the main passing shape and the links a team returns to most often.',
    ],
    caveats: [
      'A frequent link is not always the most dangerous one. It can simply be the safest outlet.',
    ],
  },
  build_up_pass_network_table: {
    title: 'Pass Network Table',
    whatItIs: [
      'This table ranks the players shown in the pass network.',
    ],
    whyItMatters: [
      'It gives a quick check on who is most involved and who connects different parts of the team.',
    ],
    calculationOrChartLabel: 'What the table shows',
    calculationOrChart: [
      'Passes and received count completed passes in the current filters.',
      'Activity score rewards frequent involvement, while connector score highlights players who link separate passing groups.',
    ],
    howToUse: [
      'Use it with the map: the table tells you who matters most, and the map shows where those links happen.',
    ],
    caveats: [
      'Network scores depend on the current filters and minimum-link setting, so small samples can move quickly.',
    ],
  },
  build_up_heatmaps: {
    title: 'Build-Up Heatmap',
    whatItIs: [
      'These heatmaps show where build-up actions are happening on the pitch.',
    ],
    whyItMatters: [
      'They help you see where a team is actually moving and recycling the ball, not just how much of it they have.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Activity mode shows where build-up actions happened overall.',
      'Handpass vs kickpass mode shows where each pass method is being used.',
      'Pass vs carry mode shows where teams are choosing to move the ball by pass or by carry.',
    ],
    howToUse: [
      'Switch between modes to see whether teams are building in the same spaces but with different methods.',
    ],
    caveats: [
      'Heatmaps show location volume, not whether the action was especially valuable on its own.',
    ],
  },
  build_up_heatmap_activity: {
    title: 'Build-Up Heatmap: Activity',
    whatItIs: [
      'This mode shows where build-up actions happened most often.',
    ],
    whyItMatters: [
      'It gives the clearest quick view of where a team is spending its build-up phases on the pitch.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Darker or busier zones mean more build-up actions were logged there inside the current filters.',
    ],
    howToUse: [
      'Use it to spot whether build-up is mainly deep, wide, central, or already happening high up the pitch.',
    ],
    caveats: [
      'It shows where actions happened, not whether those actions were especially effective.',
    ],
  },
  build_up_heatmap_hand_kick: {
    title: 'Build-Up Heatmap: Hand vs Kick',
    whatItIs: [
      'This mode compares where handpassing and kickpassing are being used in build-up.',
    ],
    whyItMatters: [
      'It helps show whether a team changes method by area of the pitch rather than using the same passing mix everywhere.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Each zone reflects the balance of handpasses and kickpasses logged there inside the current filters.',
    ],
    howToUse: [
      'Use it to see where the team prefers to play short by hand and where it is more willing to kick through or over pressure.',
    ],
    caveats: [
      'It shows method mix, not whether those passes were progressive or dangerous.',
    ],
  },
  build_up_heatmap_pass_carry: {
    title: 'Build-Up Heatmap: Pass vs Carry',
    whatItIs: [
      'This mode compares whether the team is moving the ball more by pass or by carry in each zone.',
    ],
    whyItMatters: [
      'It helps show whether progression is being created through movement on the ball or through circulation around it.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'Each zone reflects the balance between passing actions and carrying actions in the filtered sample.',
    ],
    howToUse: [
      'Use it to find the parts of the pitch where the team prefers to run the ball and where it prefers to move it early by pass.',
    ],
    caveats: [
      'It compares action type only. It does not tell you which option created the better next action.',
    ],
  },
  restarts_metrics: {
    title: 'Restart Metrics',
    whatItIs: [
      'This card gives the top-line restart battle: own kickout success, disruption of opposition kickouts, and how clean or broken those wins were.',
    ],
    whyItMatters: [
      'Kickouts can shape territory, control, and shot supply before the next phase even starts.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The ratios are built from kickouts and throw-ins inside the current filters.',
      'Disruption looks at how often the receiving side was stopped from winning the restart cleanly.',
    ],
    howToUse: [
      'Use it to judge whether a team is winning its own ball, disrupting the other side, and what type of win it is getting.',
    ],
    caveats: [
      'Strong restart numbers do not always lead to strong attack numbers unless the next phase is used well.',
    ],
  },
  restarts_metric_own_win: {
    title: 'Own Kickout Win %',
    whatItIs: [
      'This shows how often a team kept its own kickout overall inside the current filters.',
    ],
    whyItMatters: [
      'Holding your own kickout is the base layer of restart control and affects field position and possession security straight away.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Won own kickouts divided by total own kickouts taken.',
      'The card shows both the raw fraction and the percentage.',
    ],
    howToUse: [
      'Use it as the quickest read on whether a team is getting out of its own restart safely and consistently.',
    ],
    caveats: [
      'It does not tell you whether those wins were clean, broken, or valuable after the next phase.',
    ],
  },
  restarts_outcomes: {
    title: 'Kickout Outcomes',
    whatItIs: [
      'This breaks kickouts into the main result types so you can see the shape of restart wins and losses.',
    ],
    whyItMatters: [
      'It shows whether kickout battles are being won cleanly, broken, or turning into messy second-ball situations.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The chart stacks the logged kickout results for each team.',
      'Simple mode groups the main restart outcomes, while detailed mode keeps the fuller breakdown.',
    ],
    howToUse: [
      'Use it to compare the style of restart battle, not just who won more of them overall.',
    ],
    caveats: [
      'Outcome labels depend on the restart result being logged consistently.',
    ],
  },
  restarts_value: {
    title: 'Kickout Value',
    whatItIs: [
      'Kickout value shows what different restart groups were worth after the kickout, not just whether the initial ball was won.',
    ],
    whyItMatters: [
      'Some kickout patterns may win the first ball but still lead to poor attack value, while others create stronger next-phase chances.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Kickouts are grouped by the selected split and then scored by what the next chain produced in expected points and actual points.',
    ],
    howToUse: [
      'Use it to see which restart choices are truly helping attack value, not just possession retention.',
    ],
    caveats: [
      'This is still a chain-level view, so one big chance can lift a small group quickly.',
    ],
  },
  restarts_players: {
    title: 'Restart Players',
    whatItIs: [
      'This table shows which players were targeted on kickouts and what happened when the ball went to them.',
    ],
    whyItMatters: [
      'It helps identify reliable targets, contested targets, and players who turn restarts into clean wins or broken-ball wins.',
    ],
    calculationOrChartLabel: 'What the table shows',
    calculationOrChart: [
      'Targets counts how often the player was the intended kickout option.',
      'Won by team, clean won, clean lost, break won, break lost, broken, and marks all describe what happened after those target balls.',
    ],
    howToUse: [
      'Use it to compare target volume with target success instead of looking at either one on its own.',
    ],
    caveats: [
      'A low-volume target can post strong rates from only a few restarts.',
    ],
  },
  restarts_metric_disruption: {
    title: 'Opp. Kickout Disruption %',
    whatItIs: [
      'This measures how often a team stopped the opposition from getting a clean kickout win.',
    ],
    whyItMatters: [
      'It captures restart pressure and contest even when the other team still manages to recover some of the second ball.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Disrupted opposition kickouts divided by total opposition kickouts faced.',
      'A disrupted kickout is one the opposition did not secure cleanly.',
    ],
    howToUse: [
      'Use it alongside own kickout win % to judge who is controlling the full restart battle, not just their own service.',
    ],
    caveats: [
      'A disrupted kickout can still end with the opposition recovering the break ball later in the phase.',
    ],
  },
  restarts_metric_clean_win: {
    title: 'Clean Kickout Win %',
    whatItIs: [
      'This shows how often a team won its own kickout cleanly rather than through a break ball.',
    ],
    whyItMatters: [
      'Clean wins usually give better structure for the next action and reduce the chaos that can follow a broken contest.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Own clean kickout wins divided by total own kickouts taken.',
    ],
    howToUse: [
      'Use it to separate tidy restart control from restart wins that still turned into a scramble.',
    ],
    caveats: [
      'Teams can post a lower clean rate but still have a strong overall own-kickout win rate through break-ball recovery.',
    ],
  },
  restarts_metric_break_win: {
    title: 'Break Win %',
    whatItIs: [
      'This shows the share of contested break-ball kickouts that each team ended up winning.',
    ],
    whyItMatters: [
      'Break-ball strength often decides restart battles when clean claims are not available.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Break wins divided by all break-ball restart contests inside the current filters.',
    ],
    howToUse: [
      'Use it to judge second-ball reactions, support shape, and contest organisation after the initial delivery.',
    ],
    caveats: [
      'A high break-win rate does not always mean kickout execution is strong; it can also reflect how often the kickout turned messy.',
    ],
  },
  restarts_metric_throw_in_win: {
    title: 'Throw-In Win %',
    whatItIs: [
      'This measures how often a team won contested throw-ins in the current filtered sample.',
    ],
    whyItMatters: [
      'Throw-ins are another restart battle and can reveal midfield contest strength outside of kickouts.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Throw-ins won divided by contested throw-ins.',
    ],
    howToUse: [
      'Use it to see whether restart control is a kickout-only story or part of a wider aerial and second-ball edge.',
    ],
    caveats: [
      'Small numbers can swing this quickly, especially in short filtered windows.',
    ],
  },
  restarts_press_flow: {
    title: 'Kickout Flow',
    whatItIs: [
      'This follows the path from the kickout to the first result and then on toward the next possession and shot outcome.',
    ],
    whyItMatters: [
      'It helps show whether a restart win is actually leading to good next-phase outcomes.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The flow links the kickout result to what happened next, including the later possession outcome and shot result where available.',
    ],
    howToUse: [
      'Use it to compare restart patterns that merely win the ball with restart patterns that genuinely create value.',
    ],
    caveats: [
      'It is a flow summary, so it is best used to spot patterns rather than judge one isolated kickout.',
    ],
  },
  defense_metrics: {
    title: 'Defense Metrics',
    whatItIs: [
      'These are the main team defending numbers: how often a side wins the ball back, how active it is defensively, and how much it concedes.',
    ],
    whyItMatters: [
      'They show whether a defense is forcing problems, controlling possessions, and limiting damage.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The card combines turnover wins, defensive actions, defending volume per opposition possession, PPDA, and free concessions in the current filters.',
    ],
    howToUse: [
      'Read it as a balance between pressure, regain ability, and control of what the opposition is allowed to create.',
    ],
    caveats: [
      'A busy defense can post high action counts because it is under pressure, not because it is dominant.',
    ],
  },
  defense_secondary_metrics: {
    title: 'Secondary Defense Metrics',
    whatItIs: [
      'These numbers give extra context on where and how the defense is operating.',
    ],
    whyItMatters: [
      'They help explain whether regains are happening high or deep, and how much value the defense is giving up or creating from regains.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'First contact height shows where defensive engagement tends to start.',
      'The other rates look at turnovers won and shooting value conceded per opposition possession, plus the points and xP created from regains.',
    ],
    howToUse: [
      'Use this card to add context to the headline defense numbers rather than treating it as a standalone score.',
    ],
    caveats: [
      'These numbers are more descriptive than simple counts, so they need the match context around them.',
    ],
  },
  defense_flow: {
    title: 'Turnover Flow',
    whatItIs: [
      'This shows how defensive events and turnovers move into later outcomes.',
    ],
    whyItMatters: [
      'It helps you see whether a side is merely disrupting play or actually turning regains into useful next-phase results.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The flow groups defensive wins and links them to what happened next, including the following possession result and shot result.',
    ],
    howToUse: [
      'Use it to spot the regain patterns that genuinely hurt the opposition or launch attacks.',
    ],
    caveats: [
      'It is best for reading recurring patterns, not one-off events.',
    ],
  },
  defense_players: {
    title: 'Player Defensive Table',
    whatItIs: [
      'This table rolls the main defensive actions up to player level.',
    ],
    whyItMatters: [
      'It helps you see which players are doing the most ball-winning and defensive work.',
    ],
    calculationOrChartLabel: 'What the table shows',
    calculationOrChart: [
      'TO Forced is where the player caused the turnover.',
      'TO Recovered is where the player secured the loose or won ball.',
      'Defensive Actions and Fouls give the broader volume around those regains.',
    ],
    howToUse: [
      'Use it to compare players by role and task, not just by one raw total.',
    ],
    caveats: [
      'Different positions naturally produce different defensive profiles.',
    ],
  },
  shooting_expected_points: {
    title: 'xP',
    whatItIs: [
      'xP means expected points. It adds up the value of the shots a team created.',
    ],
    whyItMatters: [
      'It tells you how good the shooting chances were, even before you look at whether the team finished them well.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Each shot is given an expected points value based on its location, pressure, and shot details.',
      'The xP total is the sum of those values inside the current filters.',
    ],
    howToUse: [
      'Compare xP with actual points to see whether a team created enough to deserve more or less from its shooting.',
    ],
    caveats: [
      'xP depends on the shot detail being logged accurately.',
    ],
  },
  shooting_points_per_shot: {
    title: 'Points Per Shot',
    whatItIs: [
      'Points per shot is the actual points scored divided by shots taken.',
    ],
    whyItMatters: [
      'It gives a quick finishing number that is easy to compare across teams or filtered windows.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Total points scored from shots are divided by total shot attempts.',
    ],
    howToUse: [
      'Use it beside xP per shot to see whether the team finished above or below the quality of chances it created.',
    ],
    caveats: [
      'A very small shot sample can swing this number quickly.',
    ],
  },
  shooting_xp_per_shot: {
    title: 'xP Per Shot',
    whatItIs: [
      'xP per shot is the average expected value of each attempt.',
    ],
    whyItMatters: [
      'It helps you judge chance quality rather than raw volume.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The team xP total is divided by the number of shots.',
    ],
    howToUse: [
      'Use it to tell whether a side is living off low-value pot shots or getting cleaner, higher-value looks.',
    ],
    caveats: [
      'One or two premium chances can lift the number sharply in a short window.',
    ],
  },
  shooting_low_pressure_shots: {
    title: 'Low Pressure Shots',
    whatItIs: [
      'Low pressure shots are attempts logged with space and without strong defensive pressure at release.',
    ],
    whyItMatters: [
      'Teams that keep creating low-pressure shots are usually finding cleaner looks.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'It counts the shots tagged as low pressure in the current filters.',
    ],
    howToUse: [
      'Use it with xP and pressure-v-conversion to judge whether good looks are being created and used well.',
    ],
    caveats: [
      'It depends on the shot pressure tag being applied consistently.',
    ],
  },
  possessions_metric_possessions: {
    title: 'Possessions (Attacks)',
    whatItIs: [
      'This shows total possessions and, in brackets, how many of those became attacks.',
    ],
    whyItMatters: [
      'It separates simply having the ball from actually turning it into attacking territory.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'A possession is one spell of the ball for a team. An attack is a possession that reaches the opposition 45.',
    ],
    howToUse: [
      'Use it to see whether a team is moving a healthy share of its possessions into real attack.',
    ],
    caveats: [
      'A high possession count is not automatically a good attacking performance.',
    ],
  },
  possessions_metric_possession_pct: {
    title: 'Possession (%)',
    whatItIs: [
      'This shows live possession time and the share of possession time each team had.',
    ],
    whyItMatters: [
      'It tells you how much of the ball each team actually controlled during live play.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The clock runs only during live possessions, then each team share is turned into a percentage.',
    ],
    howToUse: [
      'Use it with points per possession so you do not mistake more ball for better use of the ball.',
    ],
    caveats: [
      'Long possession time can still produce very little if the ball is recycled without threat.',
    ],
  },
  possessions_metric_points_per_possession: {
    title: 'Points Per Possession',
    whatItIs: [
      'This shows how many points a team scores on average each time it has a possession.',
    ],
    whyItMatters: [
      'It is one of the clearest simple measures of possession efficiency.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Total points are divided by total possessions.',
    ],
    howToUse: [
      'Use it to compare attack efficiency even when the two teams had different possession counts.',
    ],
    caveats: [
      'A short hot streak can move the number quickly in a small sample.',
    ],
  },
  possessions_metric_avg_duration: {
    title: 'Average Possession Duration',
    whatItIs: [
      'This is the average length of a team possession in seconds.',
    ],
    whyItMatters: [
      'It helps show whether a team plays quickly or tends to hold the ball for longer spells.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Each possession length is measured, then the average is taken across the filtered sample.',
    ],
    howToUse: [
      'Use it with attack outcomes to judge whether longer or shorter possessions are paying off.',
    ],
    caveats: [
      'A longer possession is not always better; sometimes it simply means slower progress.',
    ],
  },
  possessions_metric_completed_passes_per_possession: {
    title: 'Completed Passes Per Possession',
    whatItIs: [
      'This shows how many completed passes a team averages in each possession.',
    ],
    whyItMatters: [
      'It gives a quick sense of how much passing sits inside the team style.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Completed passes are divided by possessions.',
    ],
    howToUse: [
      'Use it to compare direct styles with more patient or recycling styles.',
    ],
    caveats: [
      'More passing is not automatically better if it does not move the attack on.',
    ],
  },
  possessions_metric_possession_to_shot: {
    title: 'Possession To Shot %',
    whatItIs: [
      'This shows the share of possessions that end with a shot.',
    ],
    whyItMatters: [
      'It tells you how often a team turns the ball into a scoring attempt.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Possessions ending in a shot are divided by total possessions.',
    ],
    howToUse: [
      'Use it to spot whether attacks are breaking down before a shot is created.',
    ],
    caveats: [
      'It says nothing on its own about whether the shot was a good one.',
    ],
  },
  possessions_metric_transition_attack: {
    title: 'Transition Attack %',
    whatItIs: [
      'This shows how much of a team attack came in transition rather than against a set defence.',
    ],
    whyItMatters: [
      'It helps show whether a team is most dangerous on fast ball or in slower settled attacks.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Attacks tagged as transition are divided by total attacks.',
    ],
    howToUse: [
      'Use it beside points per possession and outcomes to judge what type of attack is paying off.',
    ],
    caveats: [
      'It depends on transition and set-defence tagging being applied consistently.',
    ],
  },
  build_up_metric_progressive_passes: {
    title: 'Progressive Passes',
    whatItIs: [
      'This counts completed passes that clearly move the ball meaningfully closer to goal.',
    ],
    whyItMatters: [
      'It tells you whether a team is advancing by pass rather than just keeping the ball.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Only completed passes that clear the app progressive threshold are counted.',
    ],
    howToUse: [
      'Use it to separate line-breaking passing from safer recycling.',
    ],
    caveats: [
      'The number says how often it happened, not whether the next action used that gain well.',
    ],
  },
  build_up_metric_progressive_carries: {
    title: 'Progressive Carries',
    whatItIs: [
      'This counts completed carries that move the ball meaningfully closer to goal.',
    ],
    whyItMatters: [
      'It highlights teams that break lines with the ball in hand rather than by pass alone.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Only carries that clear the app progressive threshold are counted.',
    ],
    howToUse: [
      'Use it with progressive passes to see whether forward movement is coming more by carry or by pass.',
    ],
    caveats: [
      'A team may still carry often without those carries qualifying as progressive.',
    ],
  },
  build_up_metric_switches: {
    title: 'Switches',
    whatItIs: [
      'A switch is a completed pass that moves play a long way across the pitch.',
    ],
    whyItMatters: [
      'Switches often show whether a team is using width to move defenders and open space.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The app counts completed passes that travel more than 30 metres across the pitch.',
    ],
    howToUse: [
      'Use it to spot teams that stretch the field rather than always attacking on one side.',
    ],
    caveats: [
      'A high switch count is only valuable if it actually improves the next phase of attack.',
    ],
  },
  build_up_metric_field_tilt: {
    title: 'Field Tilt',
    whatItIs: [
      'Field tilt compares how much of the attacking-territory ball use belonged to each team.',
    ],
    whyItMatters: [
      'It is a quick territory signal and often lines up with which team is pinning the other back.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'It looks at build-up activity ending in the opposition 45 and splits that share across both teams.',
    ],
    howToUse: [
      'Use it to judge territorial pressure, especially alongside momentum and possession value.',
    ],
    caveats: [
      'Territory alone does not guarantee good chances or good finishing.',
    ],
  },
  build_up_style_speed: {
    title: 'Build-Up Speed',
    whatItIs: [
      'This is the average time it takes an attack to go from live possession start to the first action inside the opposition 45.',
    ],
    whyItMatters: [
      'It helps show whether a team gets forward quickly or builds more patiently.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Each attack is timed from live possession start to first opposition-45 action, then averaged.',
    ],
    howToUse: [
      'Use it to compare tempo across teams or filtered phases of the game.',
    ],
    caveats: [
      'Quicker is not always better if it leads to rushed decisions.',
    ],
  },
  build_up_style_scoring_zone_entries: {
    title: 'Scoring Zone Entries',
    whatItIs: [
      'This counts actions that move the ball into the central high-value scoring zone.',
    ],
    whyItMatters: [
      'It is a strong clue for how often a team is reaching the most dangerous shooting space.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'A pass or carry must start outside the zone and finish inside it to count.',
    ],
    howToUse: [
      'Use it to check whether build-up is reaching danger, not just the opposition 45.',
    ],
    caveats: [
      'It measures entry, not whether the move produced a shot or score.',
    ],
  },
  build_up_style_passes_into_scoring_zone: {
    title: 'Passes Into Scoring Zone',
    whatItIs: [
      'This counts passes that directly play the ball into the scoring zone.',
    ],
    whyItMatters: [
      'It helps separate teams that pass into danger from teams that mostly carry into it.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Only passes that start outside the scoring zone and end inside it are counted.',
    ],
    howToUse: [
      'Use it beside scoring-zone entries and carries to see how the team reaches danger.',
    ],
    caveats: [
      'A high count does not automatically mean those entries were well used afterwards.',
    ],
  },
  build_up_style_passes_per_possession_minute: {
    title: 'Passes Per Possession Minute',
    whatItIs: [
      'This shows how many passes a team plays per minute of live possession time.',
    ],
    whyItMatters: [
      'It gives a tempo measure that adjusts for how long the team actually had the ball.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Completed passes are divided by live possession minutes, with dead-ball gaps removed.',
    ],
    howToUse: [
      'Use it to compare passing tempo across teams or phases of play.',
    ],
    caveats: [
      'Fast passing does not always mean better progression.',
    ],
  },
  build_up_style_avg_pass_length: {
    title: 'Average Pass Length',
    whatItIs: [
      'This is the average distance of a team completed pass.',
    ],
    whyItMatters: [
      'It helps show whether a side is moving the ball with shorter combinations or longer kicking.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The straight-line length of each completed pass is averaged inside the filter window.',
    ],
    howToUse: [
      'Use it with handpass-to-kickpass balance and sonars to read the build-up method more clearly.',
    ],
    caveats: [
      'A longer average pass length does not say whether those passes were accurate or progressive.',
    ],
  },
  build_up_style_hand_kick_ratio: {
    title: 'Handpass : Kickpass',
    whatItIs: [
      'This shows the balance between handpasses and kickpasses in the selected build-up sample.',
    ],
    whyItMatters: [
      'It helps describe whether a team is moving the ball mainly by hand or by foot.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Handpasses and kickpasses are counted and then shown as a ratio.',
    ],
    howToUse: [
      'Use it to compare style, especially when paired with sonars, pass length, and build-up speed.',
    ],
    caveats: [
      'A ratio alone cannot tell you whether the mix was effective.',
    ],
  },
  defense_metric_def_actions: {
    title: 'Defensive Actions',
    whatItIs: [
      'This is the headline count of the team defensive work captured by the app.',
    ],
    whyItMatters: [
      'It gives you the raw scale of how often the defense actively disrupted play.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'At team level it includes turnovers forced plus high-pressure opposition carries, passes, and shots.',
    ],
    howToUse: [
      'Use it with actions per possession and PPDA so raw volume is not read in isolation.',
    ],
    caveats: [
      'A high count can come from dominance or from spending long spells defending.',
    ],
  },
  defense_metric_def_actions_per_poss: {
    title: 'Def Actions / Poss',
    whatItIs: [
      'This shows how many defensive actions a team makes per opposition possession faced.',
    ],
    whyItMatters: [
      'It adds context by adjusting defensive volume for how much defending the team actually had to do.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Defensive actions are divided by opposition possessions.',
    ],
    howToUse: [
      'Use it to compare activity rates across matches or teams with different defensive workloads.',
    ],
    caveats: [
      'A high rate still needs context from what those actions led to afterwards.',
    ],
  },
  defense_metric_ppda: {
    title: 'PPDA',
    whatItIs: [
      'PPDA is opponent completed passes divided by your team defensive actions.',
    ],
    whyItMatters: [
      'It is a quick pressure number. Lower PPDA usually means the opposition gets fewer easy passes before being challenged.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Opponent completed passes are divided by your team defensive actions in the current filters.',
    ],
    howToUse: [
      'Use it to compare how aggressively or how early a team engages the opposition.',
    ],
    caveats: [
      'PPDA is best read beside first-contact height and turnover flow rather than on its own.',
    ],
  },
  defense_metric_scorable_frees: {
    title: 'Scorable Frees Conceded',
    whatItIs: [
      'This counts frees conceded in locations or situations that create a real scoring chance.',
    ],
    whyItMatters: [
      'It separates harmless fouls from concessions that hand the opposition value.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Only fouls tagged as scorable are counted here.',
    ],
    howToUse: [
      'Use it to judge discipline in dangerous moments, not just total foul count.',
    ],
    caveats: [
      'It depends on the scorable-free tagging being applied consistently.',
    ],
  },
  defense_secondary_first_contact_height: {
    title: 'First Contact Height',
    whatItIs: [
      'This shows the average pitch height where the defense first engages the opposition on the ball.',
    ],
    whyItMatters: [
      'It helps show whether a team meets attacks high, in the middle, or much deeper.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The pitch position of the first logged defensive contact is averaged across the sample.',
    ],
    howToUse: [
      'Use it with PPDA and turnover flow to understand the shape of the press.',
    ],
    caveats: [
      'The average can hide a mix of very high and very deep engagements.',
    ],
  },
  defense_secondary_to_won_rate: {
    title: 'TO Won / 10 Opp Poss',
    whatItIs: [
      'This shows how many turnovers a team wins for every 10 opposition possessions.',
    ],
    whyItMatters: [
      'It adjusts ball-winning for workload and makes cross-game comparison easier.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Turnovers won are scaled to a 10-opposition-possession base.',
    ],
    howToUse: [
      'Use it to compare regain threat without being misled by raw possession volume.',
    ],
    caveats: [
      'It says how often the ball was won, not how valuable the next phase became.',
    ],
  },
  defense_secondary_shots_conceded_rate: {
    title: 'Shots Conceded / 10 Poss',
    whatItIs: [
      'This shows how many shots the opposition gets for every 10 possessions.',
    ],
    whyItMatters: [
      'It is a simple pressure test of how often the defense still allows attempts.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Opposition shots conceded are scaled to a 10-opposition-possession base.',
    ],
    howToUse: [
      'Use it to judge how hard it is for the opposition to get a shot away.',
    ],
    caveats: [
      'It measures shot frequency, not shot quality.',
    ],
  },
  defense_secondary_xp_conceded_rate: {
    title: 'xP Conceded / 10 Poss',
    whatItIs: [
      'This shows the expected points value the opposition creates for every 10 possessions.',
    ],
    whyItMatters: [
      'It blends volume and quality into one chance-concession number.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Opposition xP conceded is scaled to a 10-opposition-possession base.',
    ],
    howToUse: [
      'Use it to compare not just how often shots are allowed, but how dangerous they are.',
    ],
    caveats: [
      'It depends on the xP model and shot detail being logged accurately.',
    ],
  },
  defense_secondary_regain_points: {
    title: 'Regain Points',
    whatItIs: [
      'This shows how many points a team scored from possessions that started from its own regain.',
    ],
    whyItMatters: [
      'It measures whether defensive wins are being turned into real scoreboard damage.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'Points scored from regain-start attacks are summed inside the current filters.',
    ],
    howToUse: [
      'Use it to judge the payoff from aggressive defending and transition moments.',
    ],
    caveats: [
      'A small number of big regain scores can move the total quickly.',
    ],
  },
  defense_secondary_regain_xp: {
    title: 'Regain xP',
    whatItIs: [
      'This shows the expected points value created from possessions that started from regains.',
    ],
    whyItMatters: [
      'It helps you see whether regains are leading to chances even before you look at actual finishing.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The xP from regain-start attacks is summed inside the current filters.',
    ],
    howToUse: [
      'Use it with regain points to separate chance creation from finishing.',
    ],
    caveats: [
      'It reflects regain-created shots only, not the full shape of every defensive sequence.',
    ],
  },
  players_shooting: {
    title: 'Player Shooting',
    whatItIs: [
      'This pane shows the selected player as a shooter: output, shot quality, shot mix, and shot map.',
    ],
    whyItMatters: [
      'It helps separate a player who gets good chances from a player who is simply finishing a hot run.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The left side gives the player shooting metrics inside the current filters and current raw or per-rate mode.',
      'The right side plots the player shots on the half-pitch and uses the same video-linked shot events shown elsewhere in the app.',
    ],
    howToUse: [
      'Use the stats for volume and efficiency, then use the shot map to check where the player is getting chances from.',
    ],
    caveats: [
      'Small samples can make percentages and xP rates jump quickly.',
    ],
  },
  players_passing: {
    title: 'Player Passing',
    whatItIs: [
      'This pane focuses on the selected player as a passer: volume, progression, accuracy, and where passes are played.',
    ],
    whyItMatters: [
      'It helps separate safe volume from passes that actually move attacks on.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics include pass totals, progressive passing, shot assists, scoring-zone passing, pass length, turnovers from passes, and first-time passing.',
      'The pass map on the right plots the player pass actions on the full pitch.',
    ],
    howToUse: [
      'Use it to decide whether the player is a recycler, a line-breaker, or a creator near score danger.',
    ],
    caveats: [
      'A high pass count is not automatically a high-impact passing game.',
    ],
  },
  players_carrying: {
    title: 'Player Carrying',
    whatItIs: [
      'This pane shows how the player moves the ball by foot or hand while carrying it.',
    ],
    whyItMatters: [
      'Carrying can break pressure, change angles, and move teams into attacking territory without a pass.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics cover carry volume, progressive carries, metres gained, take-ons, pressure, and fouls won on carries.',
      'The map shows the player carry routes, with successful and unsuccessful carries separated by color.',
    ],
    howToUse: [
      'Use it to see whether a player carries simply to keep the ball or to genuinely drive the attack forward.',
    ],
    caveats: [
      'Carry value can depend heavily on role and field position.',
    ],
  },
  players_progression: {
    title: 'Player Progression',
    whatItIs: [
      'This pane looks at how the player helps the ball move on, especially through receiving and then advancing attacks.',
    ],
    whyItMatters: [
      'It captures players who may not take the final shot but still move the team into stronger positions.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics blend receptions, progressive receptions, total progressive metres, and scorable frees won.',
      'The map shows where the player received the ball, with progressive receptions highlighted.',
    ],
    howToUse: [
      'Use it to spot connectors and link players who make attacks flow, even if their own scoring numbers are modest.',
    ],
    caveats: [
      'This pane mixes receiving and moving-on value, so it is best read as an all-round progression view.',
    ],
  },
  players_restarts: {
    title: 'Player Restarts',
    whatItIs: [
      'This pane shows how the selected player is involved in restart battles, especially as a target or winner.',
    ],
    whyItMatters: [
      'Some players shape the restart game by winning their own ball, breaking contests, or being trusted targets.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics use the same restart definitions as the main restart tables.',
      'The map shows the player kickout involvement that matches the active filters.',
    ],
    howToUse: [
      'Use it to compare target volume with what actually happened once the ball went toward that player.',
    ],
    caveats: [
      'Restart numbers can stay low for some positions simply because they are not used as primary targets.',
    ],
  },
  players_defending: {
    title: 'Player Defending',
    whatItIs: [
      'This pane shows what the selected player did on the defensive side of the ball.',
    ],
    whyItMatters: [
      'It highlights ball-winning, pressure, blocks, fouls, and overall defensive involvement.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics use the current player defensive log, while the map plots the logged defensive actions tied to that player.',
      'The card icons at the bottom show cautions and dismissals recorded against that player.',
    ],
    howToUse: [
      'Use it to compare defenders and work-rate roles, then check the map to see where that work is happening.',
    ],
    caveats: [
      'High activity can mean strong defending, but it can also mean the player had to do a lot of rescue work.',
    ],
  },
  players_defending_allowed: {
    title: 'Defending Allowed',
    whatItIs: [
      'This pane shows what the selected defender allowed while matched up to assigned attackers.',
    ],
    whyItMatters: [
      'It gives a direct defender-versus-attacker view instead of only team defending numbers.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The totals only use events that happened while the defender had a matchup stint assigned to that attacker.',
      'Per-rate mode here is based on matchup minutes, not full minutes played.',
      'The touch map shows where the matched attackers got on the ball inside those assigned windows.',
    ],
    howToUse: [
      'Use it to judge whether a defender kept a direct opponent quiet, limited touches in dangerous areas, or forced mistakes.',
    ],
    caveats: [
      'It depends on matchup stints being assigned accurately.',
      'If two defenders are deliberately assigned to the same attacker at the same time, both can receive the same event in their totals.',
    ],
  },
  players_matchups: {
    title: 'Matchups',
    whatItIs: [
      'This shows the attacker stints currently assigned to the selected defender.',
    ],
    whyItMatters: [
      'The defending-allowed numbers are built from these windows, so this is the link between the eye test and the totals.',
    ],
    calculationOrChartLabel: 'What the list shows',
    calculationOrChart: [
      'Each row shows the matched attacker and the time window used for the calculation.',
      'The total minutes chip shows how much matchup time is currently assigned to that defender.',
    ],
    howToUse: [
      'Use it to check whether the matchup setup matches the actual assignment in the game before trusting the totals.',
    ],
    caveats: [
      'If matchup windows are incomplete or too broad, the allowed stats will follow them.',
    ],
  },
  players_goalkeeper_press: {
    title: 'Kickout Press Breakdown',
    whatItIs: [
      'This pane shows how the goalkeeper performed against different kickout press looks.',
    ],
    whyItMatters: [
      'It helps separate overall kickout success from the specific press types that caused trouble or created easy exits.',
    ],
    calculationOrChartLabel: 'What the table shows',
    calculationOrChart: [
      'Overall, short, and long rows show how many own kickouts were won against each press type.',
    ],
    howToUse: [
      'Use it to see whether a goalkeeper is comfortable against zonal pressure, man-to-man pressure, or concession looks.',
    ],
    caveats: [
      'Press labels depend on the restart log being tagged consistently.',
    ],
  },
  players_goalkeeper_involvement: {
    title: 'Involvement',
    whatItIs: [
      'This pane shows the goalkeeper on the ball and in live play, not just on kickouts.',
    ],
    whyItMatters: [
      'Modern goalkeepers can influence build-up, progression, turnovers, and shot creation, not only restart retention.',
    ],
    calculationOrChartLabel: "How it's calculated",
    calculationOrChart: [
      'The metrics combine passing, carrying, progression, scoring output, and turnover involvement for the selected goalkeeper.',
    ],
    howToUse: [
      'Use it to compare keepers who simply restart safely with keepers who actively help move attacks on.',
    ],
    caveats: [
      'Goalkeeper involvement can vary a lot by team style, so compare it with role and tactical context in mind.',
    ],
  },
  players_goalkeeper_saving: {
    title: 'Saving Metrics',
    whatItIs: [
      'This pane focuses on shots on goal faced by the goalkeeper and what happened from them.',
    ],
    whyItMatters: [
      'It gives a direct view of shot-stopping load and outcome, not just general defending numbers.',
    ],
    calculationOrChartLabel: 'What the chart shows',
    calculationOrChart: [
      'The metrics count shots on goal, goals conceded, saves, wides from those shots, and the expected points attached to them.',
      'The map plots the logged shot-on-goal locations on the cropped goal-facing pitch.',
    ],
    howToUse: [
      'Use it to compare the quantity, quality, and placement of shots the goalkeeper faced.',
    ],
    caveats: [
      'It is a shot-on-goal view, so wider defensive context still matters when judging the keeper.',
    ],
  },
  video_workspace: {
    title: 'Video Workspace',
    whatItIs: [
      'This is the review area for turning logged stats into clips you can watch, save, and group together.',
    ],
    whyItMatters: [
      'It helps you move from numbers to evidence quickly, whether you want one clip, a run of events, or a full possession.',
    ],
    calculationOrChartLabel: 'What the workspace shows',
    calculationOrChart: [
      'Events Workspace lists single logged actions such as shots, passes, carries, turnovers, and fouls.',
      'Possessions Workspace groups those actions into full possessions so you can review the whole attack or defensive phase.',
      'Table, Pitch, and Split modes show the same filtered clips in different layouts, and selections build a watch queue from the current results.',
    ],
    howToUse: [
      'Use Events when you want quick examples like all kickouts, missed shots, or turnovers by one player.',
      'Use Possessions when you want to review full attacks, see how chances were built, or compare good and bad sequences side by side.',
      'A good workflow is to filter first, select the most relevant rows or pitch points, then watch the queue as one review set.',
    ],
    caveats: [
      'The workspace can only open clips that have usable linked video timing, so missing or rough timestamps will limit what opens cleanly.',
    ],
  },
};
