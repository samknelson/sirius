#!/bin/bash

# List Structure Changes Script
# Shows files changed since last push to origin/main, excluding client/* files
# For each file: displays filename, change summary, and diff
#
# Usage:
#   ./list-structure-changes.sh              # Auto-detects last pushed commit
#   ./list-structure-changes.sh <commit>     # Uses specified commit as base

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Determine base commit
if [ -n "$1" ]; then
    BASE_COMMIT="$1"
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

# Get list of changed files, excluding client/* and attached_assets/*
# Use -w to ignore whitespace-only changes
changed_files=$(git --no-pager diff -w --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' 2>/dev/null)

if [ -z "$changed_files" ]; then
    echo -e "${YELLOW}No files changed since ${BASE_COMMIT:0:12} (excluding client/* and attached_assets/*).${NC}"
    echo ""
    echo -e "${CYAN}Tip: You can specify a base commit manually:${NC}"
    echo "  ./list-structure-changes.sh <commit-hash>"
    exit 0
fi

# Filter to only files with actual non-whitespace changes
files_with_changes=""
for file in $changed_files; do
    actual_diff=$(git --no-pager diff -w "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
    if [ -n "$actual_diff" ]; then
        files_with_changes="$files_with_changes $file"
    fi
done
files_with_changes=$(echo "$files_with_changes" | xargs)

if [ -z "$files_with_changes" ]; then
    echo -e "${YELLOW}No non-whitespace changes since ${BASE_COMMIT:0:12} (excluding client/* and attached_assets/*).${NC}"
    exit 0
fi

# Count files with actual changes
file_count=$(echo "$files_with_changes" | wc -w)
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Files Changed Since: ${BASE_COMMIT:0:12}${NC}"
echo -e "${BLUE}  (excluding client/*, attached_assets/*, whitespace-only changes)${NC}"
echo -e "${BLUE}  Total: ${file_count} file(s)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Process each file
for file in $changed_files; do
    # Skip files with no actual diff after ignoring whitespace
    actual_diff=$(git --no-pager diff -w "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
    if [ -z "$actual_diff" ]; then
        continue
    fi
    
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
