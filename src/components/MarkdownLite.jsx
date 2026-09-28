// A tiny, dependency-free renderer for the small markdown subset the
// trainer's chat replies use: **bold**, *italic*/_italic_, and bullet or
// numbered lists. Everything is built as React elements — never
// dangerouslySetInnerHTML — so there's no injection surface even though
// the source text comes from the model.

function renderInline(text, keyPrefix) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let last = 0, match, i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) parts.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    else parts.push(<em key={`${keyPrefix}-${i++}`}>{match[2] ?? match[3]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function MarkdownLite({ text }) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let list = null; // {type: "ul" | "ol", items: [line, ...]}

  function flushList() {
    if (!list) return;
    const Tag = list.type;
    const key = `list-${blocks.length}`;
    blocks.push(
      <Tag key={key} style={{ margin: "6px 0", paddingLeft: 22 }}>
        {list.items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
      </Tag>
    );
    list = null;
  }

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.+)/.exec(line);
    const numbered = /^\s*\d+\.\s+(.+)/.exec(line);
    if (bullet) {
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
    } else {
      flushList();
      if (line.trim() !== "") blocks.push(<div key={`line-${blocks.length}`}>{renderInline(line, `line-${blocks.length}`)}</div>);
    }
  }
  flushList();

  return <>{blocks}</>;
}
