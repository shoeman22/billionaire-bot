import { GSwap, PrivateKeySigner } from '../../src/services/gswap-simple.js';
import { validateEnvironment } from '../../src/config/environment.js';
import 'dotenv/config';

async function debugUserAssets() {
  try {
    const config = validateEnvironment();
    const privateKey = config.wallet.privateKey;

    const gswap = new GSwap({
      signer: new PrivateKeySigner(privateKey),
      baseUrl: config.api.baseUrl
    });

    console.log('Testing getUserAssets to see what token format is returned...');

    const assetsResponse = await gswap.assets.getUserAssets(config.wallet.address, 1, 20);

    console.log('Full getUserAssets response:');
    console.log(JSON.stringify(assetsResponse, null, 2));

    if (assetsResponse?.tokens) {
      console.log('\nToken details:');
      assetsResponse.tokens.forEach((token, i) => {
        console.log(`Token ${i + 1}:`, {
          symbol: token.symbol,
          name: token.name,
          quantity: token.quantity,
          fullObject: token
        });
      });
    }

  } catch (error) {
    console.error('Debug failed:', error);
  }
}

debugUserAssets();