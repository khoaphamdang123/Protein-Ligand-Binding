import { hexToInt, plddtColor, probabilityColor } from './prediction-colors';

describe('prediction colours', () => {
  it('interpolates probability between the stops and clamps outside [0, 1]', () => {
    expect(probabilityColor(0)).toBe('#94a3b8');
    expect(probabilityColor(0.5)).toBe('#fbbf24');
    expect(probabilityColor(1)).toBe('#ef4444');
    expect(probabilityColor(-1)).toBe(probabilityColor(0));
    expect(probabilityColor(2)).toBe(probabilityColor(1));
    expect(probabilityColor(0.25)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps pLDDT (0-1) to the AlphaFold bands', () => {
    expect(plddtColor(0.95)).toBe('#0053D6');
    expect(plddtColor(0.8)).toBe('#65CBF3');
    expect(plddtColor(0.6)).toBe('#FFDB13');
    expect(plddtColor(0.3)).toBe('#FF7D45');
    expect(plddtColor(0)).toBe('#FF7D45');
  });

  it('converts hex to the integer NGL expects', () => {
    expect(hexToInt('#ff0000')).toBe(0xff0000);
  });
});
