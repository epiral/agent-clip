package internal

import (
	"fmt"
	"strconv"
	"strings"
)

func parsePositiveInt(value string) (int, error) {
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid integer %q", value)
	}
	if n < 0 {
		return 0, fmt.Errorf("integer must be non-negative: %q", value)
	}
	return n, nil
}

func parseOptionalLineCountArgs(args []string, defaultValue int) (int, error) {
	n := defaultValue
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch arg {
		case "-n":
			if index+1 >= len(args) {
				return 0, fmt.Errorf("missing value for -n")
			}
			value, err := parsePositiveInt(args[index+1])
			if err != nil {
				return 0, err
			}
			n = value
			index++
		default:
			cleaned := strings.TrimLeft(arg, "-")
			value, err := strconv.Atoi(cleaned)
			if err == nil {
				if value <= 0 {
					return 0, fmt.Errorf("line count must be positive: %q", arg)
				}
				n = value
			}
		}
	}
	return n, nil
}
