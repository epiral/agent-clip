package internal

import (
	"strings"
)

// Operator represents a chain operator between commands.
type Operator int

const (
	OpNone Operator = iota
	OpAnd           // &&
	OpSeq           // ;
	OpPipe          // |
)

// Segment is a single command in a chain.
type Segment struct {
	Raw string
	Op  Operator // operator AFTER this segment
}

// ParseChain splits a command string into segments by &&, ;, and |.
// Respects quoted strings (single and double quotes).
func ParseChain(input string) []Segment {
	var segments []Segment
	var current strings.Builder
	runes := []rune(input)
	n := len(runes)

	for i := 0; i < n; i++ {
		ch := runes[i]

		// handle quotes
		if ch == '\'' || ch == '"' {
			quote := ch
			current.WriteRune(ch)
			i++
			for i < n && runes[i] != quote {
				current.WriteRune(runes[i])
				i++
			}
			if i < n {
				current.WriteRune(runes[i])
			}
			continue
		}

		// &&
		if ch == '&' && i+1 < n && runes[i+1] == '&' {
			segments = append(segments, Segment{
				Raw: strings.TrimSpace(current.String()),
				Op:  OpAnd,
			})
			current.Reset()
			i++ // skip second &
			continue
		}

		// ;
		if ch == ';' {
			segments = append(segments, Segment{
				Raw: strings.TrimSpace(current.String()),
				Op:  OpSeq,
			})
			current.Reset()
			continue
		}

		// | (but not ||)
		if ch == '|' && (i+1 >= n || runes[i+1] != '|') {
			segments = append(segments, Segment{
				Raw: strings.TrimSpace(current.String()),
				Op:  OpPipe,
			})
			current.Reset()
			continue
		}

		current.WriteRune(ch)
	}

	// last segment
	last := strings.TrimSpace(current.String())
	if last != "" {
		segments = append(segments, Segment{Raw: last, Op: OpNone})
	}

	return segments
}
