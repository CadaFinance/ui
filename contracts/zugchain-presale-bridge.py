import time
import json
import os
import requests
from web3 import Web3
try:
    from web3.middleware import geth_poa_middleware
except ImportError:
    from web3.middleware import ExtraDataToPOAMiddleware as geth_poa_middleware
from datetime import datetime

# ==============================================================================
# CONFIGURATION
# ==============================================================================

# 1. ETHEREUM MAINNET (Source)
ETHERSCAN_API_KEY = "VCCSK5H7ZNGJRKADVRZHF1B1AKJR1MD32H"
ETH_ZUG_TOKEN = "0xF5C0A842DCdd43b3A23e06EB6e49bAaE9B92b248"  # ZUG Token on Mainnet
ETH_PRESALE_CONTRACT = "0x1CA4a1029356540fb66f62403289bCB6804f352F" # Presale Contract (Seller)
ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api"

# 2. ZUGCHAIN TESTNET (Destination)
ZUG_RPC_URL = "https://rpc.zugchain.org" # Updated RPC
ZUG_CHAIN_ID = 102219
# Treasury Private Key (Sender) - Holds the vZUG
REWARDS_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
VZUG_CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" # vZUG Contract

# 3. SETTINGS
STATE_FILE = "bridge_state.json"
POLL_INTERVAL = 30 # Seconds
START_BLOCK_DEFAULT = 23084945 # Start from user specified block
FORCE_RESCAN = True # If True, ignores saved block height but REMEMBERS processed TXs (Safe Retry)

# ==============================================================================
# SETUP
# ==============================================================================

# Connect to ZugChain
w3 = Web3(Web3.HTTPProvider(ZUG_RPC_URL))
w3.middleware_onion.inject(geth_poa_middleware, layer=0) # For POA chains

# Prepare Account
account = w3.eth.account.from_key(REWARDS_PRIVATE_KEY)
print(f"🌉 BRIDGE STARTED")
print(f"📍 Treasury Address: {account.address}")

# Verify Connection
if w3.is_connected():
    print(f"✅ Connected to ZugChain (Chain ID: {w3.eth.chain_id})")
else:
    print(f"❌ Failed to connect to ZugChain RPC at {ZUG_RPC_URL}")
    exit(1)

# Init vZUG Contract
erc20_abi = [
    {
        "constant": False,
        "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    }
]
vzug_contract = w3.eth.contract(address=VZUG_CONTRACT_ADDRESS, abi=erc20_abi)

# Topics for Filter
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
PRESALE_TOPIC = "0x000000000000000000000000" + ETH_PRESALE_CONTRACT[2:].lower() # Pad to 32 bytes

# ==============================================================================
# FUNCTIONS
# ==============================================================================

def load_state():
    """Load the last processed block from file."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {"last_block": START_BLOCK_DEFAULT, "processed_txs": []}

def save_state(state):
    """Save current state to file."""
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def get_logs(from_block):
    """Fetch logs from Etherscan."""
    params = {
        "module": "logs",
        "action": "getLogs",
        "fromBlock": from_block,
        "toBlock": "latest",
        "address": ETH_ZUG_TOKEN,
        "topic0": TRANSFER_TOPIC,      # Event Signature
        "topic1": PRESALE_TOPIC,       # From: Presale Contract
        "apikey": ETHERSCAN_API_KEY,
        "chainid": "1"                 # Mainnet (Required for V2 API)
    }
    
    try:
        response = requests.get(ETHERSCAN_API_URL, params=params, timeout=10)
        data = response.json()
        
        if data["status"] == "1":
            return data["result"]
        elif data["message"] == "No records found":
            return []
        else:
            print(f"⚠️ Etherscan Error: {data['message']} - {data.get('result', 'No details')}")
            return []
    except Exception as e:
        print(f"⚠️ Network Error: {e}")
        return []

def send_rewards(to_address, amount_wei, original_tx):
    """Send vZUG (ERC-20) on ZugChain."""
    try:
        # Check Treasury vZUG Balance
        balance = vzug_contract.functions.balanceOf(account.address).call()
        if balance < amount_wei:
            print(f"❌ Insufficient vZUG in Treasury! Needed: {w3.from_wei(amount_wei, 'ether')}, Has: {w3.from_wei(balance, 'ether')}")
            return False

        # Check Native Gas Balance
        gas_balance = w3.eth.get_balance(account.address)
        if gas_balance < w3.to_wei(0.001, 'ether'):
             print(f"❌ Insufficient Native ZUG for Gas fees!")
             return False

        # Build ERC-20 Transfer Transaction
        print(f"🔹 Preparing to send {w3.from_wei(amount_wei, 'ether')} vZUG to {to_address}...")
        
        tx_data = vzug_contract.functions.transfer(
            Web3.to_checksum_address(to_address),
            amount_wei
        ).build_transaction({
            'from': account.address,
            'nonce': w3.eth.get_transaction_count(account.address, 'pending'), # Use pending to avoid nonce collisions
            'gas': 200000, # ERC-20 Transfer usually takes ~50k, safe margin
            'gasPrice': w3.eth.gas_price,
            'chainId': ZUG_CHAIN_ID
        })

        # Sign
        signed_tx = w3.eth.account.sign_transaction(tx_data, REWARDS_PRIVATE_KEY)

        # Send
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for receipt
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        
        if receipt.status == 1:
            amount_zug = w3.from_wei(amount_wei, 'ether')
            print(f"💸 Sent {amount_zug} vZUG to {to_address}")
            print(f"   └─ Bridge TX: {w3.to_hex(tx_hash)}")
            print(f"   └─ Origin TX: {original_tx}")
            return True
        else:
            print(f"❌ Transaction failed for {to_address}")
            return False

    except Exception as e:
        print(f"❌ Error sending transaction: {e}")
        return False

# ==============================================================================
# MAIN LOOP
# ==============================================================================

def main():
    state = load_state()
    
    # Logic: If FORCE_RESCAN is on, we reset the block cursor but KEEP the list of paid txs
    # This prevents double-spending but catches any skipped/failed sales
    if FORCE_RESCAN:
        print(f"⚠️ FORCE RESCAN ENABLED: Rewinding to block {START_BLOCK_DEFAULT} (History preserved)")
        last_block = START_BLOCK_DEFAULT
    else:
        last_block = int(state.get("last_block", START_BLOCK_DEFAULT))
        
    processed_txs = set(state.get("processed_txs", []))
    
    print(f"🔄 Starting from block: {last_block}")
    
    while True:
        try:
            print(f"🔍 Checking for new sales [Block {last_block}+]...", end="\r")
            
            logs = get_logs(last_block + 1)
            
            new_last_block = last_block
            
            if logs:
                print(f"\n📦 Found {len(logs)} events!")
                
                for log in logs:
                    block_number = int(log["blockNumber"], 16)
                    tx_hash = log["transactionHash"]
                    
                    # Update max block seen
                    if block_number > new_last_block:
                        new_last_block = block_number
                    
                    # Skip duplicates
                    if tx_hash in processed_txs:
                        continue
                        
                    # Parse Event
                    # Topic 1 is 'from' (Presale) - Already filtered by API
                    # Topic 2 is 'to' (User)
                    topic2 = log["topics"][2]
                    to_address = "0x" + topic2[26:] # Remove padding
                    
                    # Data is 'value' (Amount)
                    amount_hex = log["data"]
                    amount_wei = int(amount_hex, 16)
                    
                    print(f"⚡ Processing Sale: {tx_hash}")
                    
                    # EXECUTE TRANSFER
                    success = send_rewards(to_address, amount_wei, tx_hash)
                    
                    if success:
                        processed_txs.add(tx_hash)
                    else:
                        print(f"⚠️ Failed to process {tx_hash}. Will retry in next cycle.")
                        # Critical: Do not advance block height if we failed!
                        # Break loop to retry this batch later
                        new_last_block = last_block # Revert block advancement
                        break
            
            # Update State only if we made progress or successfully checked (and didn't break due to error)
            if new_last_block > last_block:
                last_block = new_last_block
                state["last_block"] = last_block
            
            # Save state regardless to persist successful txs (processed_txs is updated)
            state["processed_txs"] = list(processed_txs)[-2000:]
            save_state(state)
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\n🛑 Bridge stopped by user.")
            break
        except Exception as e:
            print(f"\n❌ Unexpected Error: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
