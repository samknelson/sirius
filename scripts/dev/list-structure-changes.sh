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
#   ./list-structure-changes.sh --approve <file-or-pattern>
#                                            # Mark file(s) as reviewed at current HEAD
#                                            # Supports wildcards, e.g. --approve 'dist/assets/*.jpg'
#   ./list-structure-changes.sh --show-approved
#                                            # List files approved at current HEAD
#   ./list-structure-changes.sh --clear-approvals
#                                            # Remove all stored approvals

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

APPROVALS_DIR="/tmp/list-structure-changes-approvals"
APPROVALS_FILE="$APPROVALS_DIR/approvals"

LIST_ONLY=false
COMMIT_ARG=""
FILE_ARG=""
APPROVE_ARG=""
SHOW_APPROVED=false
CLEAR_APPROVALS=false

while [ $# -gt 0 ]; do
    case "$1" in
        --approve)
            if [ -z "$2" ] || [[ "$2" == --* ]]; then
                echo -e "${RED}Usage: $0 --approve <file-or-pattern>${NC}"
                echo -e "${CYAN}Examples:${NC}"
                echo "  $0 --approve dist/assets/image.jpg"
                echo "  $0 --approve 'dist/assets/*.jpg'"
                exit 1
            fi
            APPROVE_ARG="$2"
            shift 2
            ;;
        --show-approved)
            SHOW_APPROVED=true
            shift
            ;;
        --clear-approvals)
            CLEAR_APPROVALS=true
            shift
            ;;
        --list|-l)
            LIST_ONLY=true
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

HEAD_COMMIT=$(git rev-parse HEAD 2>/dev/null)

if [ "$SHOW_APPROVED" = true ]; then
    if [ ! -f "$APPROVALS_FILE" ]; then
        echo -e "${YELLOW}No approvals recorded.${NC}"
        exit 0
    fi
    found=false
    while IFS=' ' read -r commit filepath; do
        if [ "$commit" = "$HEAD_COMMIT" ]; then
            if [ "$found" = false ]; then
                echo -e "${BLUE}Approved files at HEAD (${HEAD_COMMIT:0:7}):${NC}"
                found=true
            fi
            echo -e "  ${YELLOW}${filepath}${NC}"
        fi
    done < "$APPROVALS_FILE"
    if [ "$found" = false ]; then
        echo -e "${YELLOW}No approvals for current HEAD (${HEAD_COMMIT:0:7}).${NC}"
    fi
    exit 0
fi

# Determine base commit
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

if [ -n "$APPROVE_ARG" ]; then
    mkdir -p "$APPROVALS_DIR"
    changed_for_approve=$(git --no-pager diff -w --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' ':!data/*.json' ':!database/quickstarts/*' 2>/dev/null)
    matched_files=""
    for file in $changed_for_approve; do
        # shellcheck disable=SC2254
        case "$file" in
            $APPROVE_ARG)
                matched_files="$matched_files $file"
                ;;
        esac
    done
    matched_files=$(echo "$matched_files" | xargs)

    if [ -z "$matched_files" ]; then
        echo -e "${RED}No changed files match '${APPROVE_ARG}'.${NC}"
        echo -e "${CYAN}Usage: $0 --approve <file-or-pattern>${NC}"
        echo -e "${CYAN}The pattern is matched against files changed since the base commit.${NC}"
        echo -e "${CYAN}Use --list to see currently changed files.${NC}"
        exit 1
    fi

    approved_count=0
    for file in $matched_files; do
        if grep -qFx "$HEAD_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
            echo -e "${YELLOW}Already approved: ${file}${NC}"
        else
            echo "$HEAD_COMMIT $file" >> "$APPROVALS_FILE"
            echo -e "${GREEN}Approved: ${file} (at ${HEAD_COMMIT:0:7})${NC}"
            approved_count=$((approved_count + 1))
        fi
    done
    if [ "$approved_count" -gt 0 ]; then
        echo -e "${CYAN}${approved_count} file(s) approved.${NC}"
    fi
    exit 0
fi

# Single-file mode: show diff for one specific file and exit
if [ -n "$FILE_ARG" ]; then
    echo ""
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}📄 FILE: ${YELLOW}${FILE_ARG}${NC}"
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"

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

# Filter out approved files
if [ -f "$APPROVALS_FILE" ]; then
    filtered_files=""
    for file in $files_with_changes; do
        if ! grep -qFx "$HEAD_COMMIT $file" "$APPROVALS_FILE" 2>/dev/null; then
            filtered_files="$filtered_files $file"
        fi
    done
    files_with_changes=$(echo "$filtered_files" | xargs)
fi

if [ -z "$files_with_changes" ]; then
    echo -e "${YELLOW}All changed files have been approved at current HEAD (${HEAD_COMMIT:0:7}).${NC}"
    echo -e "${CYAN}Use --show-approved to see approved files, or --clear-approvals to reset.${NC}"
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

if [ "$LIST_ONLY" = true ]; then
    for file in $files_with_changes; do
        stats=$(git --no-pager diff -w --numstat "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
        insertions=$(echo "$stats" | awk '{print $1}')
        deletions=$(echo "$stats" | awk '{print $2}')
        if [ "$insertions" = "-" ]; then
            echo -e "  ${YELLOW}${file}${NC}  ${CYAN}(binary)${NC}"
        else
            echo -e "  ${YELLOW}${file}${NC}  ${CYAN}(+${insertions:-0} -${deletions:-0})${NC}"
        fi
    done
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Tip: Run without --list to see full diffs${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    exit 0
fi

# Process each file with actual changes
for file in $files_with_changes; do
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}📄 FILE: ${YELLOW}${file}${NC}"
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    
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
