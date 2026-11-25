#!/usr/bin/env bash
# Manage koto tickets under <project-root>/.space/tickets/.
# Usage:
#   ticket.sh new    <project-root> <id> <title> [--parent <id>] [--depends-on <id,id>]
#   ticket.sh list   <project-root> [--status <status>] [--ready]
#   ticket.sh status <project-root> <id> <status>
# ticket.md is the source of truth. This script only creates the file,
# reads its frontmatter, and rewrites the status and updated fields.
set -euo pipefail

STATUSES="pending running paused done cancelled"

die() { printf 'error: %s\n' "$*" >&2; exit 2; }
usage() { sed -n '3,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

valid_id() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{0,63}$'; }
valid_status() { case " $STATUSES " in *" $1 "*) return 0 ;; esac; return 1; }

tickets_dir() {
	local root="$1"
	[ -d "$root" ] || die "not a directory: $root"
	local dir="$root/.space/tickets"
	[ -d "$dir" ] || die "missing $dir. Run the setup skill first."
	[ ! -L "$dir" ] || die "refusing a symlinked tickets directory: $dir"
	printf '%s' "$dir"
}

# Print the value of one frontmatter key. Empty when the key is absent.
field() {
	awk -v key="$2" '
		NR == 1 { if ($0 != "---") exit; next }
		$0 == "---" { exit }
		{
			i = index($0, ":")
			if (i > 0 && substr($0, 1, i - 1) == key) {
				v = substr($0, i + 1); sub(/^ +/, "", v); sub(/ +$/, "", v); print v; exit
			}
		}
	' "$1"
}

# "[a, b]" -> "a b"
list_items() { printf '%s' "$1" | tr -d '[]' | tr ',' ' '; }

cmd_new() {
	[ "$#" -ge 3 ] || usage
	local root="$1" id="$2" title="$3"
	shift 3
	local parent="" depends=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
			--parent) [ "$#" -ge 2 ] || usage; parent="$2"; shift 2 ;;
			--depends-on) [ "$#" -ge 2 ] || usage; depends="$2"; shift 2 ;;
			*) usage ;;
		esac
	done
	local dir; dir="$(tickets_dir "$root")"
	valid_id "$id" || die "invalid id '$id'. Use 1-64 lowercase letters, digits or hyphens, starting with a letter or digit."
	printf '%s' "$title" | grep -q '[^[:space:]]' || die "title is empty"
	title="$(printf '%s' "$title" | tr '\t\n\r' '   ')"
	[ ! -e "$dir/$id" ] || die "ticket already exists: $dir/$id"
	if [ -n "$parent" ]; then
		valid_id "$parent" || die "invalid parent id '$parent'"
		[ "$parent" != "$id" ] || die "a ticket cannot be its own parent"
		[ -f "$dir/$parent/ticket.md" ] || die "parent ticket not found: $parent"
	fi
	local dep deps=""
	for dep in $(list_items "$depends"); do
		valid_id "$dep" || die "invalid dependency id '$dep'"
		[ "$dep" != "$id" ] || die "a ticket cannot depend on itself"
		[ -f "$dir/$dep/ticket.md" ] || die "dependency ticket not found: $dep"
		deps="${deps:+$deps, }$dep"
	done
	local ts; ts="$(now)"
	mkdir "$dir/$id"
	cat > "$dir/$id/ticket.md" <<-EOF
	---
	id: $id
	title: $title
	status: pending
	parent:${parent:+ $parent}
	depends_on: [$deps]
	created: $ts
	updated: $ts
	---

	# $title

	## 目的

	## 終了条件

	## 成果物

	## checkpoint

	## 結果
	EOF
	printf 'created\t%s\n' "$dir/$id/ticket.md"
}

cmd_list() {
	[ "$#" -ge 1 ] || usage
	local root="$1"
	shift
	local want="" ready_only=0
	while [ "$#" -gt 0 ]; do
		case "$1" in
			--status) [ "$#" -ge 2 ] || usage; want="$2"; valid_status "$want" || die "unknown status '$want'"; shift 2 ;;
			--ready) ready_only=1; shift ;;
			*) usage ;;
		esac
	done
	local dir; dir="$(tickets_dir "$root")"
	printf 'id\tstatus\tready\tparent\tdepends_on\ttitle\n'
	local file id status parent depends title ready dep dstatus
	for file in "$dir"/*/ticket.md; do
		[ -f "$file" ] || continue
		id="$(field "$file" id)"
		status="$(field "$file" status)"
		parent="$(field "$file" parent)"
		depends="$(field "$file" depends_on)"
		title="$(field "$file" title)"
		# A pending ticket is ready when every dependency is done.
		ready="-"
		if [ "$status" = "pending" ]; then
			ready="yes"
			for dep in $(list_items "$depends"); do
				dstatus=""
				[ -f "$dir/$dep/ticket.md" ] && dstatus="$(field "$dir/$dep/ticket.md" status)"
				[ "$dstatus" = "done" ] || ready="no"
			done
		fi
		[ -z "$want" ] || [ "$status" = "$want" ] || continue
		[ "$ready_only" -eq 0 ] || [ "$ready" = "yes" ] || continue
		printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$status" "$ready" "${parent:--}" "$(list_items "$depends" | xargs)" "$title"
	done
}

allowed() {
	case "$1:$2" in
		pending:running|pending:cancelled) return 0 ;;
		running:paused|running:done|running:cancelled) return 0 ;;
		paused:running|paused:cancelled) return 0 ;;
		done:pending|cancelled:pending) return 0 ;;
	esac
	return 1
}

cmd_status() {
	[ "$#" -eq 3 ] || usage
	local root="$1" id="$2" to="$3"
	local dir; dir="$(tickets_dir "$root")"
	valid_id "$id" || die "invalid id '$id'"
	valid_status "$to" || die "unknown status '$to'. Use one of: $STATUSES"
	local file="$dir/$id/ticket.md"
	[ -f "$file" ] || die "ticket not found: $id"
	local from; from="$(field "$file" status)"
	valid_status "$from" || die "ticket $id has an unknown status '$from'"
	allowed "$from" "$to" || die "cannot change $id from $from to $to"
	if [ "$to" = "running" ]; then
		local dep dstatus
		for dep in $(list_items "$(field "$file" depends_on)"); do
			dstatus=""
			[ -f "$dir/$dep/ticket.md" ] && dstatus="$(field "$dir/$dep/ticket.md" status)"
			[ "$dstatus" = "done" ] || die "dependency $dep is ${dstatus:-missing}, not done"
		done
	fi
	if [ "$to" = "done" ]; then
		local child cstatus
		for child in "$dir"/*/ticket.md; do
			[ -f "$child" ] || continue
			[ "$(field "$child" parent)" = "$id" ] || continue
			cstatus="$(field "$child" status)"
			case "$cstatus" in done|cancelled) ;; *) die "child $(field "$child" id) is $cstatus, not done or cancelled" ;; esac
		done
	fi
	local ts tmp; ts="$(now)"
	tmp="$(mktemp "$dir/$id/.ticket.md.XXXXXX")"
	awk -v to="$to" -v ts="$ts" '
		NR == 1 && $0 == "---" { fm = 1; print; next }
		fm && $0 == "---" { fm = 0; print; next }
		fm && /^status:/ { print "status: " to; next }
		fm && /^updated:/ { print "updated: " ts; next }
		{ print }
	' "$file" > "$tmp"
	# Copy back instead of mv so the file keeps its original permissions.
	cat "$tmp" > "$file"
	rm -f "$tmp"
	printf '%s\t%s -> %s\t%s\n' "$id" "$from" "$to" "$file"
}

[ "$#" -ge 1 ] || usage
command="$1"
shift
case "$command" in
	new) cmd_new "$@" ;;
	list) cmd_list "$@" ;;
	status) cmd_status "$@" ;;
	*) usage ;;
esac
