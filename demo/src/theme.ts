// Design tokens and type for the demo video.
//
// The UI surfaces use Atlassian Design System neutrals so the Jira panel and the
// settings page look like the real product. The stage behind them is dark, which
// makes a light product window read as a product shot instead of a screenshot.

export const colors = {
  // stage
  bg: '#080D17',
  bgGlow: '#101B2E',
  surface: '#111A2B',
  surfaceHi: '#17233A',
  line: '#22304A',
  lineHi: '#2F4160',

  // text on stage
  text: '#E8EEF9',
  textMuted: '#93A3BC',
  textFaint: '#5D6D87',

  // accents
  accent: '#4C9AFF',
  accentSoft: '#1B3A66',
  green: '#36B37E',
  greenSoft: '#123A2C',
  amber: '#FFAB00',
  amberSoft: '#3D2C08',
  red: '#FF5630',
  redSoft: '#3E1B12',

  // Atlassian DS neutrals (for light UI surfaces)
  n0: '#FFFFFF',
  n10: '#F7F8F9',
  n20: '#F1F2F4',
  n30: '#EBECF0',
  n40: '#DFE1E6',
  n50: '#C1C7D0',
  n100: '#A5ADBA',
  n200: '#97A0AF',
  n300: '#8993A4',
  n400: '#7A869A',
  n500: '#6B778C',
  n600: '#5E6C84',
  n700: '#505F79',
  n800: '#42526E',
  n900: '#344563',
  n1000: '#172B4D',

  b400: '#0052CC',
  b300: '#0065FF',
  b200: '#2684FF',
  b100: '#4C9AFF',
  b75: '#B3D4FF',
  b50: '#DEEBFF',

  // Atlassian status lozenges
  lozBlue: '#DEEBFF',
  lozBlueText: '#0747A6',
  lozGreen: '#E3FCEF',
  lozGreenText: '#006644',
  lozYellow: '#FFFAE6',
  lozYellowText: '#7F5F01',
  lozPurple: '#EAE6FF',
  lozPurpleText: '#403294',
  lozRed: '#FFEBE6',
  lozRedText: '#BF2600',
  lozGrey: '#DFE1E6',
  lozGreyText: '#42526E',
} as const;

export const font = {
  sans: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace",
} as const;

export type LozengeTone = 'blue' | 'green' | 'yellow' | 'purple' | 'red' | 'grey';

export const lozengePalette: Record<LozengeTone, { bg: string; fg: string }> = {
  blue: { bg: colors.lozBlue, fg: colors.lozBlueText },
  green: { bg: colors.lozGreen, fg: colors.lozGreenText },
  yellow: { bg: colors.lozYellow, fg: colors.lozYellowText },
  purple: { bg: colors.lozPurple, fg: colors.lozPurpleText },
  red: { bg: colors.lozRed, fg: colors.lozRedText },
  grey: { bg: colors.lozGrey, fg: colors.lozGreyText },
};

export function lozengeToneFor(status: string): LozengeTone {
  switch (status) {
    case 'Triaged':
      return 'purple';
    case 'Ready for Build':
      return 'blue';
    case 'In Build':
      return 'yellow';
    case 'In Review':
      return 'blue';
    case 'Done':
      return 'green';
    case 'Failed':
      return 'red';
    default:
      return 'grey';
  }
}
