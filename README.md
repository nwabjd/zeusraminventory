# ZEUS - RAM Inventory Management

ZEUS is a professional Windows 11 desktop inventory management application for RAM buying and selling businesses operating in Sharjah and Dubai, UAE.

## Features

- **BUY RAM Workflow**: Fast, first-class purchase transaction workflow with atomic operations
- **SELL RAM Workflow**: Fast, first-class sales transaction workflow with real-time profit calculation
- **Inventory Management**: Track RAM modules by Generation (DDR4/DDR5), Category (PC/Laptop/Server), Capacity, Speed, etc.
- **Customer Management**: Separate Buyers and Sellers with balance tracking
- **Financial Tracking**: Payments, Coworker Ledger, Profit calculation, Weighted Average Costing
- **Stock Control**: Automatic stock updates, movement tracking, low stock alerts, stock protection
- **Audit Trail**: Complete audit log of all transactions
- **Reports**: Comprehensive reporting for inventory, sales, purchases, profits, and balances
- **Data Safety**: SQLite database with backup and restore capabilities
- **Offline First**: No internet required for normal operations

## Technology Stack

- **Framework**: Tauri 2.x (Rust + WebView2)
- **Frontend**: React 19 + TypeScript
- **Database**: SQLite with sqlx/tauri-plugin-sql
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Routing**: React Router DOM
- **UI Components**: Lucide React icons, Radix UI primitives

## Getting Started

### Prerequisites

- Node.js 18+ (v24.21.0 installed)
- Rust 1.70+ (1.98.1 installed)
- Visual Studio Build Tools 2022 (with C++ build tools) for Windows

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Build

```bash
# Build for production
npm run tauri build
```

The installer (.msi) and executable will be created in `src-tauri/target/release/bundle/`.

## Database Schema

The application uses SQLite with migrations. The schema includes:
- `ram_items` - Inventory items
- `buyers` / `sellers` - Customer/supplier records
- `purchases` / `purchase_items` - Purchase transactions
- `sales` / `sale_items` - Sale transactions
- `payments` - Payment records
- `stock_movements` - Audit trail of stock changes
- `coworkers` / `coworker_transactions` - Coworker lending/borrowing
- `audit_log` - System audit trail
- `settings` - Application configuration

## Key Business Rules

1. **Atomic Transactions**: BUY RAM and SELL RAM operations are fully atomic with database transactions and rollback on failure
2. **Stock Protection**: Cannot sell more than available inventory
3. **Weighted Average Cost**: Used for accurate profit calculation when same SKU purchased at different costs
4. **Separate Entities**: Buyers and Sellers are maintained as separate entities
5. **Historical Integrity**: Historical transaction costs are preserved even if future prices change
6. **Audit Trail**: Every inventory change creates a stock movement record

## License

Proprietary - ZEUS Business
