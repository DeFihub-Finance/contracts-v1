#!/bin/bash
# graphs.sh
# Usage: ./graphs.sh ContractName1 ContractName2 ...

# Step 0: Check that at least one contract name is provided
if [ "$#" -eq 0 ]; then
  echo "Usage: $0 ContractName1 [ContractName2 ...]"
  exit 1
fi

# Step 1: Flatten the entire codebase into a single file
echo "Flattening contracts using npx hardhat flatten..."
npx hardhat flatten > flattened.sol
if [ $? -ne 0 ]; then
  echo "Error: Hardhat flatten failed."
  exit 1
fi

# Step 2: Clear NUL characters from the flattened file (overwrite the same file)
echo "Removing NUL characters from flattened.sol..."
# The tr command will delete all NUL (\0) characters
tr -d '\000' < flattened.sol > flattened_clean.sol
if [ $? -ne 0 ]; then
  echo "Error: Removing NUL characters failed."
  exit 1
fi
# Replace the original file with the cleaned one
mv flattened_clean.sol flattened.sol

# Step 3: For each contract name provided, run sol2uml storage command.
for contract in "$@"; do
  echo "Generating UML chart for contract '$contract'"
  npx sol2uml storage flattened.sol -c "$contract" -o ./uml/"$contract".svg
  if [ $? -ne 0 ]; then
    echo "Error: sol2uml storage failed for contract '$contract'."
    exit 1
  fi
done

# Step 4: Delete the flattened file, keeping only the generated UML charts.
echo "Deleting temporary flattened file..."
rm flattened.sol

echo "Done. UML charts generated for: $*"
