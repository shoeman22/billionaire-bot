import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import dotenv from 'dotenv';

dotenv.config();

async function testQuoteMethod() {
  const gSwap = new GSwap({
    signer: new PrivateKeySigner(process.env.WALLET_PRIVATE_KEY!),
  });

  const USDC_SELLING_AMOUNT = 10; // Amount of USDC to sell

  // Quote how much $GALA you can get for 10 USDC
  const quote = await gSwap.quoting.quoteExactInput(
    'GUSDC|Unit|none|none',
    'GALA|Unit|none|none',
    USDC_SELLING_AMOUNT,
  );

  console.log(`Best rate found on ${quote.feeTier} fee tier pool`);
  console.log(`You would get ${quote.outTokenAmount} GALA for ${USDC_SELLING_AMOUNT} USDC`);

  // Execute a swap using the best fee tier from the quote (commented out for safety)
  /*
  const result = await gSwap.swap(
    'GUSDC|Unit|none|none',
    'GALA|Unit|none|none',
    quote.feeTier,
    {
      exactIn: USDC_SELLING_AMOUNT,
      amountOutMinimum: quote.outTokenAmount.multipliedBy(0.95), // 5% slippage
    },
    process.env.WALLET_ADDRESS!,
  );
  */
}

testQuoteMethod().catch(console.error);