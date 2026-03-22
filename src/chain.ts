export enum Operator {
  None,
  And,
  Or,
  Seq,
  Pipe,
}

export interface Segment {
  raw: string;
  op: Operator;
}

export function parseChain(input: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  const chars = Array.from(input);

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];

    if (char === "'" || char === '"') {
      const quote = char;
      current += char;
      index += 1;
      while (index < chars.length && chars[index] !== quote) {
        current += chars[index];
        index += 1;
      }
      if (index < chars.length) {
        current += chars[index];
      }
      continue;
    }

    if (char === "&" && chars[index + 1] === "&") {
      segments.push({ raw: current.trim(), op: Operator.And });
      current = "";
      index += 1;
      continue;
    }

    if (char === ";") {
      segments.push({ raw: current.trim(), op: Operator.Seq });
      current = "";
      continue;
    }

    if (char === "|" && chars[index + 1] === "|") {
      segments.push({ raw: current.trim(), op: Operator.Or });
      current = "";
      index += 1;
      continue;
    }

    if (char === "|") {
      segments.push({ raw: current.trim(), op: Operator.Pipe });
      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) {
    segments.push({ raw: last, op: Operator.None });
  }

  return segments;
}
