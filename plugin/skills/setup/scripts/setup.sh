#!/usr/bin/env bash
# Create koto's storage area (.space/) in a project root.
# Usage: setup.sh <project-root>
# Safe to run again: it never overwrites or deletes existing files.
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'usage: setup.sh <project-root>\n' >&2
	exit 1
fi

root="$1"
if [ ! -d "$root" ]; then
	printf 'error: not a directory: %s\n' "$root" >&2
	exit 1
fi
root="$(cd "$root" && pwd -P)"

space="$root/.space"
tickets="$space/tickets"

for path in "$space" "$tickets"; do
	if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
		printf 'error: exists but is not a plain directory: %s\n' "$path" >&2
		exit 1
	fi
done

report() { printf '%s\t%s\n' "$1" "$2"; }

for path in "$space" "$tickets"; do
	if [ -d "$path" ]; then
		report kept "$path"
	else
		mkdir "$path"
		report created "$path"
	fi
done

# Git does not track empty directories. Keep tickets/ visible in a fresh clone.
keep="$tickets/.gitkeep"
if [ -e "$keep" ]; then
	report kept "$keep"
else
	: > "$keep"
	report created "$keep"
fi
