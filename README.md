# aztec-flush

## Prerequisites

Node.js (v18 or higher)
Multiple Ethereum wallets with ETH for gas fees
Ethereum RPC endpoint (Alchemy, Infura, or your own node)
Basic understanding of running scripts and environment variables

Step 1: Project Setup
bash# Create a new directory
mkdir aztec-flush-bot
cd aztec-flush-bot

# Initialize npm project
npm init -y

# Install dependencies
npm install ethers@6 dotenv


# Step 2: Create Environment File
Create a .env file in your project root and copy the contents of .env-example to .env


# Step 5: Running the Bot
 Run the bot
 you can create neew wallet with: node createwallet
 it saves the wallet keys to wallet.txt; fund wallet with eth

 # START FLUSH
node flush.js
