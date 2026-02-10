#!/usr/bin/env node

/**
 * Import top 100 Binance symbols into the database
 * Fetches symbols from Binance API and inserts them into PostgreSQL
 */

import pg from 'pg'
import https from 'https'

const { Client } = pg

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'newpt',
  user: process.env.DB_USER || process.env.USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
}

// Binance API endpoints
const BINANCE_EXCHANGE_INFO = 'https://api.binance.com/api/v3/exchangeInfo'
const BINANCE_24H_TICKER = 'https://api.binance.com/api/v3/ticker/24hr'

// Asset class mapping
const ASSET_CLASS_MAP = {
  'BTC': 'Crypto',
  'ETH': 'Crypto',
  'BNB': 'Crypto',
  'USDT': 'Crypto',
  'USDC': 'Crypto',
  'BUSD': 'Crypto',
  // Add more as needed - default to Crypto
}

function getAssetClass(baseCurrency) {
  return ASSET_CLASS_MAP[baseCurrency] || 'Crypto'
}

function parseSymbol(symbol) {
  // Common quote currencies
  const quoteCurrencies = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']
  
  for (const quote of quoteCurrencies) {
    if (symbol.endsWith(quote)) {
      return {
        base: symbol.slice(0, -quote.length),
        quote: quote,
      }
    }
  }
  
  // Fallback: try to split at common patterns
  if (symbol.length >= 6) {
    return {
      base: symbol.slice(0, -4),
      quote: symbol.slice(-4),
    }
  }
  
  return {
    base: symbol,
    quote: 'USDT',
  }
}

function getPricePrecision(priceFilter) {
  if (!priceFilter || !priceFilter.tickSize) return 2
  
  const tickSize = parseFloat(priceFilter.tickSize)
  if (tickSize >= 1) return 0
  if (tickSize >= 0.1) return 1
  if (tickSize >= 0.01) return 2
  if (tickSize >= 0.001) return 3
  if (tickSize >= 0.0001) return 4
  if (tickSize >= 0.00001) return 5
  if (tickSize >= 0.000001) return 6
  if (tickSize >= 0.0000001) return 7
  if (tickSize >= 0.00000001) return 8
  return 8
}

function getVolumePrecision(lotSizeFilter) {
  if (!lotSizeFilter || !lotSizeFilter.stepSize) return 2
  
  const stepSize = parseFloat(lotSizeFilter.stepSize)
  if (stepSize >= 1) return 0
  if (stepSize >= 0.1) return 1
  if (stepSize >= 0.01) return 2
  if (stepSize >= 0.001) return 3
  if (stepSize >= 0.0001) return 4
  if (stepSize >= 0.00001) return 5
  if (stepSize >= 0.000001) return 6
  if (stepSize >= 0.0000001) return 7
  if (stepSize >= 0.00000001) return 8
  return 8
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

async function getTopSymbols() {
  console.log('📡 Fetching Binance exchange info...')
  const exchangeInfo = await fetchJSON(BINANCE_EXCHANGE_INFO)
  
  console.log('📡 Fetching 24h ticker data...')
  const ticker24h = await fetchJSON(BINANCE_24H_TICKER)
  
  // Create a map of symbol -> volume
  const volumeMap = new Map()
  ticker24h.forEach((ticker) => {
    const volume = parseFloat(ticker.quoteVolume || ticker.volume || '0')
    volumeMap.set(ticker.symbol, volume)
  })
  
  // Filter active spot trading symbols and sort by volume
  const symbols = exchangeInfo.symbols
    .filter((s) => {
      // Filter for active trading symbols
      const isTrading = s.status === 'TRADING'
      // Check if it's a spot symbol (not futures)
      const isSpot = !s.symbol.includes('_') && !s.symbol.endsWith('DOWN') && !s.symbol.endsWith('UP')
      // Only include USDT pairs for now
      const isUSDT = s.symbol.endsWith('USDT')
      return isTrading && isSpot && isUSDT
    })
    .map((s) => ({
      ...s,
      volume: volumeMap.get(s.symbol) || 0,
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 100) // Top 100
  
  return symbols
}

async function importSymbols() {
  const client = new Client(DB_CONFIG)
  
  try {
    console.log('🔌 Connecting to database...')
    await client.connect()
    
    console.log('📥 Fetching top 100 Binance symbols...')
    const symbols = await getTopSymbols()
    
    console.log(`✅ Found ${symbols.length} symbols`)
    console.log('💾 Inserting symbols into database...')
    
    let inserted = 0
    let skipped = 0
    
    for (const symbol of symbols) {
      try {
        const { base, quote } = parseSymbol(symbol.symbol)
        const assetClass = getAssetClass(base)
        
        // Find filters
        const priceFilter = symbol.filters.find((f) => f.filterType === 'PRICE_FILTER')
        const lotSizeFilter = symbol.filters.find((f) => f.filterType === 'LOT_SIZE')
        
        const pricePrecision = getPricePrecision(priceFilter)
        const volumePrecision = getVolumePrecision(lotSizeFilter)
        const tickSize = priceFilter?.tickSize || '0.01'
        const contractSize = '1' // Spot trading uses 1:1
        
        // Check if symbol already exists
        const existing = await client.query(
          'SELECT id FROM symbols WHERE code = $1',
          [symbol.symbol]
        )
        
        if (existing.rows.length > 0) {
          console.log(`⏭️  Skipping ${symbol.symbol} (already exists)`)
          skipped++
          continue
        }
        
        // Map asset class to market type
        const marketType = assetClass === 'Crypto' ? 'crypto' : 
                          assetClass === 'FX' ? 'forex' :
                          assetClass === 'Metals' ? 'metals' :
                          assetClass === 'Indices' ? 'indices' :
                          assetClass === 'Stocks' ? 'stocks' : 'crypto'
        
        // Insert symbol
        await client.query(
          `INSERT INTO symbols (
            code, provider_symbol, asset_class, market, base_currency, quote_currency,
            price_precision, volume_precision, contract_size, is_enabled, trading_enabled
          ) VALUES ($1, $2, $3::asset_class, $4::market_type, $5, $6, $7, $8, $9::numeric, $10, $11)
          ON CONFLICT (code) DO NOTHING`,
          [
            symbol.symbol,
            symbol.symbol.toLowerCase(),
            assetClass,
            marketType,
            base,
            quote,
            pricePrecision,
            volumePrecision,
            contractSize,
            true, // is_enabled
            true, // trading_enabled
          ]
        )
        
        inserted++
        if (inserted % 10 === 0) {
          console.log(`   Inserted ${inserted}/${symbols.length} symbols...`)
        }
      } catch (error) {
        console.error(`❌ Error inserting ${symbol.symbol}:`, error.message)
      }
    }
    
    console.log('\n✅ Import complete!')
    console.log(`   Inserted: ${inserted}`)
    console.log(`   Skipped: ${skipped}`)
    console.log(`   Total: ${symbols.length}`)
    
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

// Run the import
importSymbols().catch(console.error)

