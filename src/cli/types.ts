/**
 * CLI-specific types and interfaces
 */

/**
 * Global options available on all commands
 */
export interface GlobalOptions {
  /** RPC endpoint URL */
  rpcUrl?: string;
  /** Path to wallet keypair JSON file */
  wallet?: string;
  /** Output in JSON format */
  json?: boolean;
}

/**
 * Wallet balance command options
 */
export interface WalletBalanceOptions extends GlobalOptions {
  /** Wallet address (optional, defaults to current wallet) */
  address?: string;
}

/**
 * Token balance command options
 */
export interface TokenBalanceOptions extends GlobalOptions {
  /** Token address */
  tokenAddress: string;
  /** Owner address (optional, defaults to current wallet) */
  owner?: string;
}

/**
 * Transaction status command options
 */
export interface TxStatusOptions extends GlobalOptions {
  /** Transaction signature */
  signature: string;
}

/**
 * Transfer NARA command options
 */
export interface TransferNaraOptions extends GlobalOptions {
  /** Recipient address */
  to: string;
  /** Amount in NARA */
  amount: number;
  /** Export unsigned transaction */
  exportTx?: boolean;
}

/**
 * Transfer token command options
 */
export interface TransferTokenOptions extends GlobalOptions {
  /** Token address */
  tokenAddress: string;
  /** Recipient address */
  to: string;
  /** Amount in tokens */
  amount: number;
  /** Token decimals */
  decimals?: number;
  /** Export unsigned transaction */
  exportTx?: boolean;
}
