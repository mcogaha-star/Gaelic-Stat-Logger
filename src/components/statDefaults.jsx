export const DEFAULT_CLICK_STATS = [
    { value: 'shot', label: 'Shot', color: '#22c55e', category: 'click', visible: true },
    { value: 'kickout', label: 'Kickout', color: '#8b5cf6', category: 'click', visible: true },
    { value: 'turnover', label: 'Turnover', color: '#ef4444', category: 'click', visible: true },
    { value: 'foul', label: 'Foul', color: '#eab308', category: 'click', visible: true },
    { value: 'defensive_contact', label: 'Defensive Contact', color: '#64748b', category: 'click', visible: true },
    { value: 'throw_in', label: 'Throw In', color: '#0ea5e9', category: 'click', visible: true },
];

export const DEFAULT_DRAG_STATS = [
    { value: 'pass', label: 'Pass', color: '#06b6d4', visible: true },
    { value: 'carry', label: 'Carry', color: '#14b8a6', visible: true },
];

export const DEFAULT_DEFAULTS = {
    half: 'first',
    // When true, the player picker defaults to the last-used recipient/player.
    quick_log_enabled: true,
};

export const DEFAULT_CUSTOM_FIELDS = {
    custom_1: { enabled: false, label: '', options: [] },
    custom_2: { enabled: false, label: '', options: [] },
    custom_3: { enabled: false, label: '', options: [] },
};

// Sub-menus are now a dynamic array of section objects.
// Each section: { id, label, applies_to[], display_type, condition, group, default_value, options[] }
//   id: unique key (also used as the stat field name in StatEntry)
//   label: display label (editable)
//   applies_to: array of stat type values that trigger this section
//   display_type: 'buttons' | 'radio' | 'select'
//   condition: null | 'not_handpass' | 'only_play' | 'foul_type_show'
//   group: 'pre' | 'post' — for pass type, 'post' sections render after the Recipient picker
//   default_value: pre-selected value (editable)
//   options: [{ value, label }] (editable)

const SCORING = ['goal','point','2_point','wide','short','saved','short_retained','blocked','blocked_retained','saved_retained','saved_for_45'];

export const DEFAULT_SUB_MENUS = [
    {
        id: 'pass_body', label: 'Body Part', applies_to: ['pass'],
        display_type: 'buttons', condition: null, group: 'pre', default_value: '',
        options: [{ value: 'right', label: 'Right Foot' }, { value: 'left', label: 'Left Foot' }, { value: 'handpass', label: 'Handpass' }],
    },
    {
        id: 'pass_style', label: 'Pass Style', applies_to: ['pass'],
        display_type: 'buttons', condition: 'not_handpass', group: 'pre', default_value: '',
        options: [{ value: 'high', label: 'High' }, { value: 'chest', label: 'Chest' }, { value: 'one_bounce', label: '1 Bounce' }, { value: 'two_plus_bounce', label: '2+ Bounce' }, { value: 'ground', label: 'Ground' }],
    },
    {
        id: 'pass_pressure', label: 'Pressure on Passer', applies_to: ['pass'],
        display_type: 'buttons', condition: null, group: 'pre', default_value: '',
        options: [{ value: 'open', label: 'Open' }, { value: 'mild', label: 'Mild' }, { value: 'heavy', label: 'Heavy' }],
    },
    {
        id: 'pass_outcome', label: 'Pass Outcome', applies_to: ['pass'],
        display_type: 'select', condition: null, group: 'post', default_value: '',
        options: [
            { value: 'completed', label: 'Completed' }, { value: 'intercepted', label: 'Intercepted' },
            { value: 'sideline_against', label: 'Sideline Against' }, { value: 'sideline_for', label: 'Sideline For' },
            { value: 'free_won', label: 'Free Won' }, { value: 'free_lost', label: 'Free Lost' },
            { value: 'over_endline', label: 'Over Endline' }, { value: '45_won', label: '45 Won' },
        ],
    },
    {
        id: 'kickout_outcome', label: 'Kickout Outcome', applies_to: ['kickout'],
        display_type: 'select', condition: null, group: 'post', default_value: '',
        options: [
            { value: 'won_clean', label: 'Won Clean' }, { value: 'lost_clean', label: 'Lost Clean' },
            { value: 'won_break', label: 'Won Break' }, { value: 'lost_break', label: 'Lost Break' },
            { value: 'foul', label: 'Foul' },
            { value: 'sideline_won', label: 'Sideline Won' }, { value: 'sideline_lost', label: 'Sideline Lost' },
        ],
    },
    {
        id: 'carry_outcome', label: 'Carry Outcome', applies_to: ['carry'],
        display_type: 'select', condition: null, group: 'post', default_value: '',
        options: [
            { value: 'free_won', label: 'Free Won' },
            { value: 'free_against', label: 'Free Against' },
            { value: 'completed', label: 'Completed' },
            { value: 'dispossessed', label: 'Dispossessed' },
        ],
    },
    {
        id: 'shot_situation', label: 'Shot Situation', applies_to: SCORING,
        display_type: 'radio', condition: null, group: 'pre', default_value: '',
        options: [{ value: 'free_kick', label: 'Free Kick' }, { value: '45', label: '45' }, { value: 'sideline', label: 'Sideline' }, { value: 'mark', label: 'Mark' }, { value: 'play', label: 'Play' }],
    },
    {
        id: 'shot_pressure', label: 'Shot Pressure', applies_to: SCORING,
        display_type: 'radio', condition: 'only_play', group: 'pre', default_value: '',
        options: [{ value: 'open', label: 'Open' }, { value: 'mild_pressure', label: 'Mild' }, { value: 'heavy_pressure', label: 'Heavy' }],
    },
    {
        id: 'shot_foot', label: 'Foot', applies_to: SCORING,
        display_type: 'radio', condition: null, group: 'pre', default_value: '',
        options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
    },
    {
        id: 'turnover_type', label: 'Turnover Type', applies_to: ['turnover'],
        display_type: 'select', condition: null, group: 'post', default_value: '',
        options: [
            { value: 'block', label: 'Block' }, { value: 'interception', label: 'Interception' },
            { value: 'individual_tackle', label: 'Individual Tackle' }, { value: 'group_tackle', label: 'Group Tackle' },
            { value: 'unforced', label: 'Unforced' }, { value: 'foul', label: 'Foul' },
        ],
    },
    {
        id: 'foul_type', label: 'Foul Type', applies_to: ['foul', 'turnover', 'pass', 'carry'],
        display_type: 'select', condition: 'show_foul_panel', group: 'post', default_value: '',
        options: [
            { value: 'breach', label: 'Breach' },
            { value: 'advancement', label: 'Advancement' },
            { value: 'pull', label: 'Pull' },
            { value: 'push', label: 'Push' },
            { value: 'high_tackle', label: 'High Tackle' },
            { value: 'square_ball', label: 'Square Ball' },
        ],
    },
    {
        id: 'card', label: 'Card', applies_to: ['foul', 'turnover', 'pass', 'carry'],
        display_type: 'buttons', condition: 'show_foul_panel', group: 'post', default_value: 'none',
        options: [
            { value: 'none', label: 'None' },
            { value: 'yellow', label: 'Yellow' },
            { value: 'black', label: 'Black' },
            { value: 'red', label: 'Red' },
        ],
    },
    {
        id: 'kickout_mark', label: 'Mark', applies_to: ['kickout'],
        display_type: 'buttons', condition: 'kickout_mark_show', group: 'post', default_value: '',
        options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
        ],
    },
    {
        id: 'kickpass_mark', label: 'Mark', applies_to: ['pass'],
        display_type: 'buttons', condition: 'kickpass_mark_show', group: 'post', default_value: '',
        options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
        ],
    },
];
