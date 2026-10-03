/** 用于说明设计范围和纹样方向的示意图，不代表 AI 生成结果。 */
export function CueMiniature({ selected = [], tone = 'jade', pattern = false, decorativeRings = true, ringIds = ['ring-joint', 'ring-deco'] }: { selected?: string[]; tone?: string; pattern?: boolean; decorativeRings?: boolean; ringIds?: string[] }) {
  const color = tone === 'gold' ? '#b4914c' : tone === 'silver' ? '#b9c7d0' : '#3b9b83';
  const fill = (id: string, base: string) => selected.includes(id) ? '#367b5a' : base;
  return <svg viewBox="0 0 280 54" aria-hidden="true" className="cue-miniature">
    <path d="M6 23.5L78 21V33L6 30.5Z" fill="#dac7a0" />
    <path d="M78 21L158 18.5V35.5L78 33Z" fill={fill('butt-forearm', pattern ? '#25392f' : '#bbbdb0')} />
    <path d="M160 18.5L235 16V38L160 35.5Z" fill={fill('grip', '#454e47')} />
    <path d="M238 16L271 15V39L238 38Z" fill={fill('butt-cap', pattern ? '#25392f' : '#bbbdb0')} />
    <path d="M74 21V33M158 18.5V35.5M235 16V38M271 15V39" stroke={pattern ? color : '#f4eee0'} strokeWidth="3" />
    <path d="M273 15.5V38.5" stroke="#233629" strokeWidth="4" />
    {pattern && <g fill="none" stroke={color} strokeWidth="1.5">
      <path d="M84 27L148 22L132 27L148 32Z M242 27L266 20L258 27L266 34Z" />
      <path d="M100 27L147 25L138 27L147 29Z M168 24L226 22M168 30L226 32" opacity=".65" />
    </g>}
    {decorativeRings && !pattern && ringIds.includes('ring-deco') && <path d="M158 17V37" stroke="#d1a453" strokeWidth="5" />}
    {decorativeRings && !pattern && ringIds.includes('ring-joint') && <path d="M76 20V34" stroke="#d1a453" strokeWidth="5" />}
  </svg>;
}
