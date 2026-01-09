require('dotenv').config();
const { ethers } = require('ethers');

// Contract addresses
const FLUSH_REWARDER_ADDRESS = '0x7C9a7130379F1B5dd6e7A53AF84fC0fE32267B65';
const ROLLUP_ADDRESS = '0x603bb2c05D474794ea97805e8De69bCcFb3bCA12';

// Minimal ABIs
const FLUSH_REWARDER_ABI = [
    'function flushEntryQueue() external',
    'function claimRewards() external',
    'function rewardsOf(address) view returns (uint256)',
    'function rewardsAvailable() view returns (uint256)'
];

const ROLLUP_ABI = [
    'function getCurrentSlot() external view returns (uint256)',
    'function getSlotDuration() external view returns (uint256)',
    'function getEpochDuration() external view returns (uint256)'
];

// Configuration
const MAX_GAS_PRICE = ethers.parseUnits(process.env.MAX_GAS_PRICE_GWEI || '50', 'gwei');
const EPOCH_DURATION = parseInt(process.env.EPOCH_DURATION_SECONDS || '2304'); // 38.4 minutes
const FLUSH_OFFSET = parseInt(process.env.FLUSH_OFFSET_SECONDS || '2');

// Global state
let wallets = [];
let lastFlushedEpoch = -1;

class EpochTracker {
    constructor(provider, rollupContract) {
        this.provider = provider;
        this.rollupContract = rollupContract;
        this.genesisTime = null;
        this.slotDuration = null;
        this.epochDuration = null;
    }

    async initialize() {
        console.log('🔍 Initializing epoch tracker...');

        try {
            // Get slot and epoch durations from contract
            this.slotDuration = Number(await this.rollupContract.getSlotDuration());
            this.epochDuration = Number(await this.rollupContract.getEpochDuration());

            console.log(`📊 Slot Duration: ${this.slotDuration} seconds`);
            console.log(`📊 Epoch Duration: ${this.epochDuration} seconds`);

            // Calculate current epoch
            const currentEpoch = await this.getCurrentEpoch();
            console.log(`📊 Current Epoch: ${currentEpoch}`);

            return currentEpoch;
        } catch (error) {
            console.error('❌ Error initializing epoch tracker:', error.message);
            throw error;
        }
    }

    async getCurrentEpoch() {
        // Calculate epoch based on current time and epoch duration
        const now = Math.floor(Date.now() / 1000);
        const epoch = Math.floor(now / this.epochDuration);
        return epoch;
    }

    async getSecondsUntilNextEpoch() {
        const now = Math.floor(Date.now() / 1000);
        const currentEpochStart = Math.floor(now / this.epochDuration) * this.epochDuration;
        const nextEpochStart = currentEpochStart + this.epochDuration;
        return nextEpochStart - now;
    }

    async waitForNextEpoch() {
        const secondsToWait = await this.getSecondsUntilNextEpoch() + FLUSH_OFFSET;
        console.log(`⏳ Waiting ${secondsToWait} seconds until flush window...`);

        // Show countdown every minute
        let remaining = secondsToWait;
        while (remaining > 0) {
            const waitTime = Math.min(60, remaining);
            await sleep(waitTime * 1000);
            remaining -= waitTime;
            if (remaining > 0) {
                console.log(`   ⏰ ${Math.floor(remaining / 60)}m ${remaining % 60}s remaining...`);
            }
        }
    }
}

class MultiWalletManager {
    constructor(privateKeys, provider) {
        this.wallets = privateKeys.map(key => new ethers.Wallet(key.trim(), provider));
        this.currentIndex = 0;
        this.successCounts = new Array(this.wallets.length).fill(0);
        this.failCounts = new Array(this.wallets.length).fill(0);
    }

    getNextWallet() {
        const wallet = this.wallets[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.wallets.length;
        return wallet;
    }

    getAllWallets() {
        return this.wallets;
    }

    recordSuccess(walletAddress) {
        const index = this.wallets.findIndex(w => w.address === walletAddress);
        if (index !== -1) this.successCounts[index]++;
    }

    recordFailure(walletAddress) {
        const index = this.wallets.findIndex(w => w.address === walletAddress);
        if (index !== -1) this.failCounts[index]++;
    }

    getStats() {
        return this.wallets.map((wallet, i) => ({
            address: wallet.address,
            successes: this.successCounts[i],
            failures: this.failCounts[i],
            successRate: this.successCounts[i] / (this.successCounts[i] + this.failCounts[i] || 1)
        }));
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    console.log('🤖 Aztec Flush Rewarder Bot Starting (Advanced Mode)...');
    console.log('━'.repeat(60));

    // Parse and setup multiple wallets
    const privateKeys = process.env.PRIVATE_KEYS.split(',').filter(k => k.trim());
    if (privateKeys.length === 0) {
        throw new Error('No private keys provided in PRIVATE_KEYS');
    }

    const walletManager = new MultiWalletManager(privateKeys, provider);
    wallets = walletManager.getAllWallets();

    console.log(`👛 Loaded ${wallets.length} wallet(s):`);
    for (const wallet of wallets) {
        const balance = await provider.getBalance(wallet.address);
        console.log(`   ${wallet.address}: ${ethers.formatEther(balance)} ETH`);
    }
    console.log('');

    // Connect to contracts
    const rollupContract = new ethers.Contract(ROLLUP_ADDRESS, ROLLUP_ABI, provider);
    const epochTracker = new EpochTracker(provider, rollupContract);

    // Initialize epoch tracking
    const currentEpoch = await epochTracker.initialize();
    lastFlushedEpoch = Number(currentEpoch) - 1;

    console.log('━'.repeat(60));
    console.log('✅ Bot initialized successfully!');
    console.log('🎯 Strategy: Multi-wallet with precise epoch timing');
    console.log('━'.repeat(60));
    console.log('');

    // Check initial rewards across all wallets
    await checkAllRewards(wallets);

    // Main loop - synchronized to epoch boundaries
    while (true) {
        try {
            // Wait until the optimal flush time
            await epochTracker.waitForNextEpoch();

            const currentEpoch = await epochTracker.getCurrentEpoch();
            console.log('');
            console.log('═'.repeat(60));
            console.log(`🆕 NEW EPOCH ${currentEpoch} - FLUSH WINDOW OPEN`);
            console.log('═'.repeat(60));

            // Only attempt if we haven't flushed this epoch yet
            if (currentEpoch > lastFlushedEpoch) {
                await attemptMultiWalletFlush(walletManager, provider);
                lastFlushedEpoch = currentEpoch;
            } else {
                console.log('ℹ️  Already flushed this epoch, waiting for next...');
            }

            // Show wallet statistics
            console.log('');
            console.log('📊 Wallet Performance:');
            const stats = walletManager.getStats();
            stats.forEach((s, i) => {
                console.log(`   [${i + 1}] ${s.address.slice(0, 10)}...: ${s.successes} ✅ / ${s.failures} ❌ (${(s.successRate * 100).toFixed(1)}%)`);
            });

        } catch (error) {
            console.error('❌ Error in main loop:', error.message);
            await sleep(30000);
        }
    }
}

async function attemptMultiWalletFlush(walletManager, provider) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🚀 Attempting flush with multiple wallets...`);

    // Check gas price first
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice;

    console.log('⛽ Current Gas Price:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');

    if (gasPrice > MAX_GAS_PRICE) {
        console.log('⚠️  Gas price too high, skipping this epoch');
        return;
    }

    // Try with multiple wallets simultaneously
    const wallets = walletManager.getAllWallets();
    const flushPromises = wallets.map((wallet, index) =>
        attemptFlushWithWallet(wallet, provider, index, walletManager)
    );

    const results = await Promise.allSettled(flushPromises);

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    console.log(`📈 Result: ${successCount}/${wallets.length} wallet(s) successfully flushed`);

    await checkAllRewards(wallets);
}

async function attemptFlushWithWallet(wallet, provider, walletIndex, walletManager) {
    const contract = new ethers.Contract(
        FLUSH_REWARDER_ADDRESS,
        FLUSH_REWARDER_ABI,
        wallet
    );

    try {
        // Small random delay to stagger transactions (0-500ms)
        const delay = Math.random() * 500;
        await sleep(delay);

        console.log(`   [Wallet ${walletIndex + 1}] Estimating gas...`);
        const gasEstimate = await contract.flushEntryQueue.estimateGas();

        const feeData = await provider.getFeeData();
        const txOptions = {
            gasLimit: gasEstimate * 120n / 100n,
        };

        if (feeData.maxFeePerGas) {
            txOptions.maxFeePerGas = feeData.maxFeePerGas;
            txOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        }

        console.log(`   [Wallet ${walletIndex + 1}] 📤 Sending transaction...`);
        const tx = await contract.flushEntryQueue(txOptions);

        console.log(`   [Wallet ${walletIndex + 1}] 🔗 TX: ${tx.hash}`);

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`   [Wallet ${walletIndex + 1}] ✅ SUCCESS!`);
            console.log(`   [Wallet ${walletIndex + 1}] ⛽ Gas Used: ${receipt.gasUsed.toString()}`);

            const gasPrice = receipt.gasPrice || feeData.gasPrice;
            const cost = receipt.gasUsed * gasPrice;
            console.log(`   [Wallet ${walletIndex + 1}] 💰 Cost: ${ethers.formatEther(cost)} ETH`);

            walletManager.recordSuccess(wallet.address);

            // Check if auto-claim needed
            const rewards = await contract.rewardsOf(wallet.address);
            if (rewards > ethers.parseEther('1000')) {
                console.log(`   [Wallet ${walletIndex + 1}] 💎 Auto-claiming ${ethers.formatEther(rewards)} AZTEC...`);
                const claimTx = await contract.claimRewards();
                await claimTx.wait();
                console.log(`   [Wallet ${walletIndex + 1}] ✅ Rewards claimed!`);
            }

            return true;
        } else {
            console.log(`   [Wallet ${walletIndex + 1}] ❌ Transaction failed`);
            walletManager.recordFailure(wallet.address);
            return false;
        }

    } catch (error) {
        if (error.message.includes('execution reverted') || error.message.includes('already flushed')) {
            console.log(`   [Wallet ${walletIndex + 1}] ℹ️  No validators to flush (likely already flushed)`);
        } else if (error.message.includes('replacement fee too low')) {
            console.log(`   [Wallet ${walletIndex + 1}] ⚠️  Transaction replaced (someone was faster)`);
        } else {
            console.log(`   [Wallet ${walletIndex + 1}] ❌ Error: ${error.message.substring(0, 100)}`);
        }
        walletManager.recordFailure(wallet.address);
        return false;
    }
}

async function checkAllRewards(wallets) {
    console.log('');
    console.log('🎁 Checking rewards across all wallets...');

    for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i];
        const contract = new ethers.Contract(
            FLUSH_REWARDER_ADDRESS,
            FLUSH_REWARDER_ABI,
            wallet
        );

        try {
            const rewards = await contract.rewardsOf(wallet.address);
            if (rewards > 0) {
                console.log(`   [Wallet ${i + 1}] ${wallet.address.slice(0, 10)}...: ${ethers.formatEther(rewards)} AZTEC`);
            }
        } catch (error) {
            console.log(`   [Wallet ${i + 1}] Error checking rewards: ${error.message}`);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n\n👋 Shutting down bot...');

    if (wallets.length > 0) {
        await checkAllRewards(wallets);
    }

    process.exit(0);
});

// Start the bot
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});