#!/bin/bash

# List Structure Changes Script
# Shows files changed since last push to origin/main, excluding client/*, attached_assets/*, data/*.json, and database/quickstarts/* files
# For each file: displays filename, change summary, and diff
#
# Usage:
#   ./list-structure-changes.sh              # Auto-detects last pushed commit, shows full diffs
#   ./list-structure-changes.sh --list       # Files only (no diffs)
#   ./list-structure-changes.sh <file>       # Show diff for a single file
#   ./list-structure-changes.sh <commit>     # Uses specified commit as base
#   ./list-structure-changes.sh --list <commit>
#   ./list-structure-changes.sh --approve <file-or-pattern> [more files...]
#                                            # Mark file(s) as reviewed
#                                            # Supports wildcards and shell-expanded globs
#                                            # e.g. --approve 'dist/assets/*.jpg'
#                                            # e.g. --approve server/wizards/types/btu*
#   ./list-structure-changes.sh --show-approved
#                                            # List files approved at current HEAD
#   ./list-structure-changes.sh --clear-approvals
#                                            # Remove all stored approvals
#   ./list-structure-changes.sh --reject <file-or-pattern> [more files...] <reason>
#                                            # Mark file(s) as rejected with a reason (last arg)
#                                            # Supports wildcards and shell-expanded globs
#                                            # e.g. --reject 'server/*.ts' "breaks API"
#                                            # e.g. --reject server/wizards/types/btu* "needs review"
#   ./list-structure-changes.sh --review
#                                            # Interactive file-by-file review session
#                                            # For each unreviewed file: shows diff, then
#                                            # prompts to [a]pprove, [r]eject, [s]kip, or [q]uit
#   ./list-structure-changes.sh --show-rejected
#                                            # List files rejected at current HEAD with reasons
#   ./list-structure-changes.sh --clear-rejections
#                                            # Remove all stored rejections

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APPROVALS_DIR="$PROJECT_ROOT/.local/review-state"
APPROVALS_FILE="$APPROVALS_DIR/approvals"
REJECTIONS_FILE="$APPROVALS_DIR/rejections"

LIST_ONLY=false
COMMIT_ARG=""
FILE_ARG=""
APPROVE_ARGS=()
REJECT_ARGS=()
REJECT_REASON=""
SHOW_APPROVED=false
CLEAR_APPROVALS=false
SHOW_REJECTED=false
CLEAR_REJECTIONS=false
INTERACTIVE_MODE=false

while [ $# -gt 0 ]; do
    case "$1" in
        --approve)
            shift
            if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
                echo -e "${RED}Usage: $0 --approve <file-or-pattern> [more files...]${NC}"
                echo -e "${CYAN}Examples:${NC}"
                echo "  $0 --approve dist/assets/image.jpg"
                echo "  $0 --approve 'dist/assets/*.jpg'"
                echo "  $0 --approve server/wizards/types/btu*"
                exit 1
            fi
            while [ $# -gt 0 ] && [[ "$1" != --* ]]; do
                APPROVE_ARGS+=("$1")
                shift
            done
            ;;
        --reject)
            shift
            if [ $# -lt 2 ] || [[ "$1" == --* ]]; then
                echo -e "${RED}Usage: $0 --reject <file-or-pattern> [more files...] <reason>${NC}"
                echo -e "${CYAN}The last argument is always the reason.${NC}"
                echo -e "${CYAN}Examples:${NC}"
                echo "  $0 --reject server/routes.ts \"breaks API contract\""
                echo "  $0 --reject 'server/*.ts' \"needs refactoring\""
                echo "  $0 --reject server/wizards/types/btu* \"needs review\""
                exit 1
            fi
            local_args=()
            while [ $# -gt 0 ] && [[ "$1" != --* ]]; do
                local_args+=("$1")
                shift
            done
            if [ ${#local_args[@]} -lt 2 ]; then
                echo -e "${RED}Error: --reject requires at least a file pattern and a reason.${NC}"
                echo -e "${RED}Usage: $0 --reject <file-or-pattern> [more files...] <reason>${NC}"
                echo -e "${CYAN}The last argument is always the reason.${NC}"
                exit 1
            fi
            REJECT_REASON="${local_args[${#local_args[@]}-1]}"
            REJECT_ARGS=("${local_args[@]:0:${#local_args[@]}-1}")
            ;;
        --show-approved)
            SHOW_APPROVED=true
            shift
            ;;
        --clear-approvals)
            CLEAR_APPROVALS=true
            shift
            ;;
        --show-rejected)
            SHOW_REJECTED=true
            shift
            ;;
        --clear-rejections)
            CLEAR_REJECTIONS=true
            shift
            ;;
        --list|-l)
            LIST_ONLY=true
            shift
            ;;
        --review)
            INTERACTIVE_MODE=true
            shift
            ;;
        *)
            if [ -f "$1" ]; then
                FILE_ARG="$1"
            else
                COMMIT_ARG="$1"
            fi
            shift
            ;;
    esac
done

if [ "$CLEAR_APPROVALS" = true ]; then
    if [ -f "$APPROVALS_FILE" ]; then
        rm "$APPROVALS_FILE"
        echo -e "${GREEN}All approvals cleared.${NC}"
    else
        echo -e "${YELLOW}No approvals to clear.${NC}"
    fi
    exit 0
fi

if [ "$CLEAR_REJECTIONS" = true ]; then
    if [ -f "$REJECTIONS_FILE" ]; then
        rm "$REJECTIONS_FILE"
        echo -e "${GREEN}All rejections cleared.${NC}"
    else
        echo -e "${YELLOW}No rejections to clear.${NC}"
    fi
    exit 0
fi

# Determine base commit (must happen before --show-approved/--show-rejected since they key on it)
if [ -n "$COMMIT_ARG" ]; then
    BASE_COMMIT="$COMMIT_ARG"
    echo -e "${CYAN}Using provided base commit: ${BASE_COMMIT}${NC}"
else
    # Strategy 1: Try git merge-base to find common ancestor with origin/main
    BASE_COMMIT=$(git merge-base origin/main HEAD 2>/dev/null)
    
    if [ -n "$BASE_COMMIT" ]; then
        # Check if there are actually differences
        diff_check=$(git --no-pager diff --name-only "$BASE_COMMIT"..HEAD 2>/dev/null)
        if [ -n "$diff_check" ]; then
            echo -e "${CYAN}Using merge-base with origin/main: ${BASE_COMMIT:0:7}${NC}"
        else
            BASE_COMMIT=""
        fi
    fi
    
    # Strategy 2: Find the last "Merge branch 'main'" commit from GitHub
    if [ -z "$BASE_COMMIT" ]; then
        BASE_COMMIT=$(git --no-pager log --oneline --grep="Merge branch 'main'" -1 --format="%H" 2>/dev/null)
        if [ -n "$BASE_COMMIT" ]; then
            echo -e "${CYAN}Using last GitHub merge commit: ${BASE_COMMIT:0:7}${NC}"
        fi
    fi
    
    # Strategy 3: Find any merge commit
    if [ -z "$BASE_COMMIT" ]; then
        BASE_COMMIT=$(git --no-pager log --oneline --merges -1 --format="%H" 2>/dev/null)
        if [ -n "$BASE_COMMIT" ]; then
            echo -e "${CYAN}Using last merge commit: ${BASE_COMMIT:0:7}${NC}"
        fi
    fi
    
    # Strategy 4: Fall back to origin/main directly
    if [ -z "$BASE_COMMIT" ]; then
        BASE_COMMIT="origin/main"
        diff_check=$(git --no-pager diff --name-only "$BASE_COMMIT"..HEAD 2>/dev/null)
        if [ -n "$diff_check" ]; then
            echo -e "${CYAN}Using origin/main as base${NC}"
        else
            echo -e "${YELLOW}Could not detect last pushed commit.${NC}"
            echo -e "${CYAN}Tip: Specify a base commit manually:${NC}"
            echo "  ./list-structure-changes.sh <commit-hash>"
            exit 0
        fi
    fi
fi

if [ "$SHOW_APPROVED" = true ]; then
    if [ ! -f "$APPROVALS_FILE" ]; then
        echo -e "${YELLOW}No approvals recorded.${NC}"
        exit 0
    fi
    found=false
    while IFS=' ' read -r commit filepath; do
        if [ "$commit" = "$BASE_COMMIT" ]; then
            if [ "$found" = false ]; then
                echo -e "${BLUE}Approved files (base ${BASE_COMMIT:0:7}):${NC}"
                found=true
            fi
            echo -e "  ${YELLOW}${filepath}${NC}"
        fi
    done < "$APPROVALS_FILE"
    if [ "$found" = false ]; then
        echo -e "${YELLOW}No approvals for current base (${BASE_COMMIT:0:7}).${NC}"
    fi
    exit 0
fi

if [ "$SHOW_REJECTED" = true ]; then
    if [ ! -f "$REJECTIONS_FILE" ]; then
        echo -e "${YELLOW}No rejections recorded.${NC}"
        exit 0
    fi
    found=false
    while IFS=$'\t' read -r commit filepath reason; do
        if [ "$commit" = "$BASE_COMMIT" ]; then
            if [ "$found" = false ]; then
                echo -e "${BLUE}Rejected files (base ${BASE_COMMIT:0:7}):${NC}"
                found=true
            fi
            echo -e "  ${RED}${filepath}${NC}  ${CYAN}Reason: ${reason}${NC}"
        fi
    done < "$REJECTIONS_FILE"
    if [ "$found" = false ]; then
        echo -e "${YELLOW}No rejections for current base (${BASE_COMMIT:0:7}).${NC}"
    fi
    exit 0
fi

match_files_by_patterns() {
    local changed_files_list="$1"
    shift
    local patterns=("$@")
    local matched=""
    for file in $changed_files_list; do
        for pattern in "${patterns[@]}"; do
            if [ "$file" = "$pattern" ]; then
                matched="$matched $file"
                break
            fi
            # shellcheck disable=SC2254
            case "$file" in
                $pattern)
                    matched="$matched $file"
                    break
                    ;;
            esac
        done
    done
    echo "$matched" | xargs
}

if [ ${#APPROVE_ARGS[@]} -gt 0 ]; then
    mkdir -p "$APPROVALS_DIR"
    changed_for_approve=$(git --no-pager diff -w --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' ':!data/*.json' ':!database/quickstarts/*' 2>/dev/null)
    matched_files=$(match_files_by_patterns "$changed_for_approve" "${APPROVE_ARGS[@]}")

    if [ -z "$matched_files" ]; then
        echo -e "${RED}No changed files match the given pattern(s).${NC}"
        echo -e "${CYAN}Usage: $0 --approve <file-or-pattern> [more files...]${NC}"
        echo -e "${CYAN}The pattern is matched against files changed since the base commit.${NC}"
        echo -e "${CYAN}Use --list to see currently changed files.${NC}"
        exit 1
    fi

    approved_count=0
    for file in $matched_files; do
        # Remove any prior rejection for this file
        if [ -f "$REJECTIONS_FILE" ]; then
            if awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '$1 == c && $2 == f { found=1; exit } END { exit !found }' "$REJECTIONS_FILE" 2>/dev/null; then
                tmp=$(mktemp)
                awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '!($1 == c && $2 == f)' "$REJECTIONS_FILE" > "$tmp" && mv "$tmp" "$REJECTIONS_FILE"
                echo -e "${CYAN}Cleared previous rejection for: ${file}${NC}"
            fi
        fi
        if grep -qFx "$BASE_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
            echo -e "${YELLOW}Already approved: ${file}${NC}"
        else
            echo "$BASE_COMMIT $file" >> "$APPROVALS_FILE"
            echo -e "${GREEN}Approved: ${file} (base ${BASE_COMMIT:0:7})${NC}"
            approved_count=$((approved_count + 1))
        fi
    done
    if [ "$approved_count" -gt 0 ]; then
        echo -e "${CYAN}${approved_count} file(s) approved.${NC}"
    fi
    exit 0
fi

if [ ${#REJECT_ARGS[@]} -gt 0 ]; then
    mkdir -p "$APPROVALS_DIR"
    changed_for_reject=$(git --no-pager diff -w --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' ':!data/*.json' ':!database/quickstarts/*' 2>/dev/null)
    matched_files=$(match_files_by_patterns "$changed_for_reject" "${REJECT_ARGS[@]}")

    if [ -z "$matched_files" ]; then
        echo -e "${RED}No changed files match the given pattern(s).${NC}"
        echo -e "${CYAN}Usage: $0 --reject <file-or-pattern> [more files...] <reason>${NC}"
        echo -e "${CYAN}The pattern is matched against files changed since the base commit.${NC}"
        echo -e "${CYAN}Use --list to see currently changed files.${NC}"
        exit 1
    fi

    rejected_count=0
    for file in $matched_files; do
        # Remove any prior approval for this file
        if [ -f "$APPROVALS_FILE" ]; then
            if grep -qFx "$BASE_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
                tmp=$(mktemp)
                grep -vFx "$BASE_COMMIT $file" "$APPROVALS_FILE" > "$tmp" && mv "$tmp" "$APPROVALS_FILE"
                echo -e "${CYAN}Cleared previous approval for: ${file}${NC}"
            fi
        fi
        if awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '$1 == c && $2 == f { found=1; exit } END { exit !found }' "$REJECTIONS_FILE" 2>/dev/null; then
            echo -e "${YELLOW}Already rejected: ${file}${NC}"
        else
            printf '%s\t%s\t%s\n' "$BASE_COMMIT" "$file" "$REJECT_REASON" >> "$REJECTIONS_FILE"
            echo -e "${RED}Rejected: ${file} (base ${BASE_COMMIT:0:7})${NC}"
            echo -e "${CYAN}  Reason: ${REJECT_REASON}${NC}"
            rejected_count=$((rejected_count + 1))
        fi
    done
    if [ "$rejected_count" -gt 0 ]; then
        echo -e "${CYAN}${rejected_count} file(s) rejected.${NC}"
    fi
    exit 0
fi

get_rejection_reason() {
    local check_file="$1"
    if [ -f "$REJECTIONS_FILE" ]; then
        while IFS=$'\t' read -r commit filepath reason; do
            if [ "$commit" = "$BASE_COMMIT" ] && [ "$filepath" = "$check_file" ]; then
                echo "$reason"
                return 0
            fi
        done < "$REJECTIONS_FILE"
    fi
    return 1
}

# Single-file mode: show diff for one specific file and exit
if [ -n "$FILE_ARG" ]; then
    echo ""
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}📄 FILE: ${YELLOW}${FILE_ARG}${NC}"
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"

    rejection_reason=$(get_rejection_reason "$FILE_ARG")
    if [ -n "$rejection_reason" ]; then
        echo -e "${RED}❌ REJECTED: ${rejection_reason}${NC}"
    fi

    stats=$(git --no-pager diff -w --numstat "$BASE_COMMIT"..HEAD -- "$FILE_ARG" 2>/dev/null)
    insertions=$(echo "$stats" | awk '{print $1}')
    deletions=$(echo "$stats" | awk '{print $2}')

    if [ -z "$stats" ]; then
        echo -e "${YELLOW}No changes to this file since ${BASE_COMMIT:0:12}.${NC}"
        exit 0
    fi

    if [ "$insertions" = "-" ]; then
        echo -e "${CYAN}📊 SUMMARY:${NC} Binary file changed"
    else
        echo -e "${CYAN}📊 SUMMARY:${NC} +${insertions:-0} insertions, -${deletions:-0} deletions"
    fi
    echo ""
    echo -e "${CYAN}📝 DIFF:${NC}"
    echo ""
    git --no-pager diff -w "$BASE_COMMIT"..HEAD -- "$FILE_ARG" 2>/dev/null
    echo ""
    exit 0
fi

# Get list of changed files, excluding client/* and attached_assets/*
# Use -w to ignore whitespace-only changes
changed_files=$(git --no-pager diff -w --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' ':!data/*.json' ':!database/quickstarts/*' 2>/dev/null)

if [ -z "$changed_files" ]; then
    echo -e "${YELLOW}No files changed since ${BASE_COMMIT:0:12} (excluding client/*, attached_assets/*, data/*.json).${NC}"
    echo ""
    echo -e "${CYAN}Tip: You can specify a base commit manually:${NC}"
    echo "  ./list-structure-changes.sh <commit-hash>"
    exit 0
fi

# Function to normalize content (remove all whitespace and newlines)
normalize_content() {
    tr -d '[:space:]'
}

# Filter to only files with actual non-whitespace/formatting changes
files_with_changes=""
for file in $changed_files; do
    # Check if file exists in both versions
    old_content=$(git show "$BASE_COMMIT":"$file" 2>/dev/null | normalize_content)
    new_content=$(git show HEAD:"$file" 2>/dev/null | normalize_content)
    
    # If file is new (old doesn't exist) or deleted (new doesn't exist), include it
    if [ -z "$old_content" ] || [ -z "$new_content" ]; then
        files_with_changes="$files_with_changes $file"
    # Compare normalized content - if different, there are real changes
    elif [ "$old_content" != "$new_content" ]; then
        files_with_changes="$files_with_changes $file"
    fi
done
files_with_changes=$(echo "$files_with_changes" | xargs)

if [ -z "$files_with_changes" ]; then
    echo -e "${YELLOW}No non-whitespace changes since ${BASE_COMMIT:0:12} (excluding client/*, attached_assets/*, data/*.json).${NC}"
    exit 0
fi

# Helper: check if a file is approved at current base commit
is_approved() {
    local check_file="$1"
    if [ -f "$APPROVALS_FILE" ]; then
        grep -qFx "$BASE_COMMIT $check_file" "$APPROVALS_FILE" 2>/dev/null
        return $?
    fi
    return 1
}

# In --list mode, show ALL files (approved, rejected, and unreviewed) with status badges
if [ "$LIST_ONLY" = true ]; then
    file_count=$(echo "$files_with_changes" | wc -w)
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Files Changed Since: ${BASE_COMMIT:0:12}${NC}"
    echo -e "${BLUE}  (excluding client/*, attached_assets/*, data/*.json,${NC}"
    echo -e "${BLUE}   database/quickstarts/*, whitespace-only changes)${NC}"
    echo -e "${BLUE}  Total: ${file_count} file(s)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    for file in $files_with_changes; do
        stats=$(git --no-pager diff -w --numstat "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
        insertions=$(echo "$stats" | awk '{print $1}')
        deletions=$(echo "$stats" | awk '{print $2}')
        if [ "$insertions" = "-" ]; then
            stat_label="${CYAN}(binary)${NC}"
        else
            stat_label="${CYAN}(+${insertions:-0} -${deletions:-0})${NC}"
        fi
        rejection_reason=$(get_rejection_reason "$file")
        if [ -n "$rejection_reason" ]; then
            echo -e "  ${RED}${file}${NC}  ${stat_label}  ${RED}❌ REJECTED: ${rejection_reason}${NC}"
        elif is_approved "$file"; then
            echo -e "  ${GREEN}${file}${NC}  ${stat_label}  ${GREEN}✔ APPROVED${NC}"
        else
            echo -e "  ${YELLOW}${file}${NC}  ${stat_label}"
        fi
    done
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Tip: Run without --list to see full diffs${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    exit 0
fi

# For full-diff mode, filter out approved files (but keep rejected files visible — rejection overrides approval)
if [ -f "$APPROVALS_FILE" ]; then
    filtered_files=""
    for file in $files_with_changes; do
        if is_approved "$file"; then
            if get_rejection_reason "$file" > /dev/null 2>&1; then
                filtered_files="$filtered_files $file"
            fi
        else
            filtered_files="$filtered_files $file"
        fi
    done
    files_with_changes=$(echo "$filtered_files" | xargs)
fi

if [ -z "$files_with_changes" ]; then
    echo -e "${YELLOW}All changed files have been approved (base ${BASE_COMMIT:0:7}).${NC}"
    echo -e "${CYAN}Use --show-approved to see approved files, or --clear-approvals to reset.${NC}"
    exit 0
fi

print_session_summary() {
    local approved=$1 rejected=$2 skipped=$3 remaining=$4
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Session: ${GREEN}${approved} approved${BLUE}, ${RED}${rejected} rejected${BLUE}, ${YELLOW}${skipped} skipped${BLUE} (${remaining} remaining)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
}

if [ "$INTERACTIVE_MODE" = true ]; then
    mkdir -p "$APPROVALS_DIR"
    file_count=$(echo "$files_with_changes" | wc -w)
    file_index=0
    session_approved=0
    session_rejected=0
    session_skipped=0

    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Interactive Review — ${file_count} file(s) to review${NC}"
    echo -e "${BLUE}  Base: ${BASE_COMMIT:0:12}${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"

    for file in $files_with_changes; do
        file_index=$((file_index + 1))
        echo ""
        echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
        echo -e "${CYAN}  File ${file_index} of ${file_count}${NC}"

        rejection_reason=$(get_rejection_reason "$file")
        if [ -n "$rejection_reason" ]; then
            echo -e "${RED}📄 FILE: ${file}${NC}"
            echo -e "${RED}❌ Previously rejected: ${rejection_reason}${NC}"
        else
            echo -e "${GREEN}📄 FILE: ${YELLOW}${file}${NC}"
        fi
        echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"

        stats=$(git --no-pager diff -w --numstat "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
        insertions=$(echo "$stats" | awk '{print $1}')
        deletions=$(echo "$stats" | awk '{print $2}')
        if [ "$insertions" = "-" ]; then
            echo -e "${CYAN}📊 SUMMARY:${NC} Binary file changed"
        else
            echo -e "${CYAN}📊 SUMMARY:${NC} +${insertions:-0} insertions, -${deletions:-0} deletions"
        fi
        echo ""
        echo -e "${CYAN}📝 DIFF:${NC}"
        echo ""
        git --no-pager diff -w "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null
        echo ""

        while true; do
            echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
            echo -en "  ${GREEN}[a]${NC}pprove  ${RED}[r]${NC}eject  ${YELLOW}[s]${NC}kip  [q]uit  > "
            read -r choice </dev/tty
            case "$choice" in
                a|A)
                    # Clear any prior rejection
                    if [ -f "$REJECTIONS_FILE" ]; then
                        if awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '$1 == c && $2 == f { found=1; exit } END { exit !found }' "$REJECTIONS_FILE" 2>/dev/null; then
                            tmp=$(mktemp)
                            awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '!($1 == c && $2 == f)' "$REJECTIONS_FILE" > "$tmp" && mv "$tmp" "$REJECTIONS_FILE"
                        fi
                    fi
                    if ! grep -qFx "$BASE_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
                        echo "$BASE_COMMIT $file" >> "$APPROVALS_FILE"
                    fi
                    echo -e "  ${GREEN}✔ Approved: ${file}${NC}"
                    session_approved=$((session_approved + 1))
                    break
                    ;;
                r|R)
                    echo -en "  ${RED}Reason: ${NC}"
                    read -r reason </dev/tty
                    if [ -z "$reason" ]; then
                        echo -e "  ${YELLOW}Rejection requires a reason. Try again.${NC}"
                        continue
                    fi
                    # Clear any prior approval
                    if [ -f "$APPROVALS_FILE" ]; then
                        if grep -qFx "$BASE_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
                            tmp=$(mktemp)
                            grep -vFx "$BASE_COMMIT $file" "$APPROVALS_FILE" > "$tmp" && mv "$tmp" "$APPROVALS_FILE"
                        fi
                    fi
                    if [ -f "$REJECTIONS_FILE" ]; then
                        tmp_rej=$(awk -F'\t' -v c="$BASE_COMMIT" -v f="$file" '!($1 == c && $2 == f)' "$REJECTIONS_FILE")
                        echo "$tmp_rej" > "$REJECTIONS_FILE"
                    fi
                    printf '%s\t%s\t%s\n' "$BASE_COMMIT" "$file" "$reason" >> "$REJECTIONS_FILE"
                    echo -e "  ${RED}✘ Rejected: ${file}${NC}"
                    echo -e "  ${CYAN}  Reason: ${reason}${NC}"
                    session_rejected=$((session_rejected + 1))
                    break
                    ;;
                s|S)
                    echo -e "  ${YELLOW}⏭ Skipped: ${file}${NC}"
                    session_skipped=$((session_skipped + 1))
                    break
                    ;;
                q|Q)
                    remaining=$((file_count - file_index + 1))
                    print_session_summary $session_approved $session_rejected $session_skipped $remaining
                    exit 0
                    ;;
                *)
                    echo -e "  ${YELLOW}Invalid choice. Use a/r/s/q.${NC}"
                    ;;
            esac
        done
    done

    print_session_summary $session_approved $session_rejected $session_skipped 0
    exit 0
fi

# Count files with actual changes
file_count=$(echo "$files_with_changes" | wc -w)
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Files Changed Since: ${BASE_COMMIT:0:12}${NC}"
echo -e "${BLUE}  (excluding client/*, attached_assets/*, data/*.json,${NC}"
echo -e "${BLUE}   database/quickstarts/*, whitespace-only changes)${NC}"
echo -e "${BLUE}  Total: ${file_count} file(s)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Process each file with actual changes
for file in $files_with_changes; do
    rejection_reason=$(get_rejection_reason "$file")
    if [ -n "$rejection_reason" ]; then
        echo -e "${RED}────────────────────────────────────────────────────────────────${NC}"
        echo -e "${RED}📄 FILE: ${file}${NC}"
        echo -e "${RED}❌ REJECTED: ${rejection_reason}${NC}"
        echo -e "${RED}────────────────────────────────────────────────────────────────${NC}"
    else
        echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
        echo -e "${GREEN}📄 FILE: ${YELLOW}${file}${NC}"
        echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    fi
    
    # Get insertions and deletions count (ignoring whitespace)
    stats=$(git --no-pager diff -w --numstat "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
    insertions=$(echo "$stats" | awk '{print $1}')
    deletions=$(echo "$stats" | awk '{print $2}')
    
    # Handle binary files
    if [ "$insertions" = "-" ]; then
        echo -e "${CYAN}📊 SUMMARY:${NC} Binary file changed"
    else
        echo -e "${CYAN}📊 SUMMARY:${NC} +${insertions:-0} insertions, -${deletions:-0} deletions"
    fi
    echo ""
    
    echo -e "${CYAN}📝 DIFF:${NC}"
    echo ""
    
    # Show the diff with context (ignoring whitespace)
    git --no-pager diff -w "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null
    
    echo ""
done

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  End of Changes Report${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
