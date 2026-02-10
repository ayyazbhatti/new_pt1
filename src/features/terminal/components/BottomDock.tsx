import { Columns, Download, Wallet, TrendingUp, Shield, DollarSign, Gift, Percent, ArrowUpRight, ArrowDownRight, X, Edit, Trash2, XCircle, Package, FileText, History, Bot, AlertCircle } from 'lucide-react'
import { mockPositions, mockOrders, mockOrderHistory, mockPositionHistory } from '@/shared/mock/terminalMock'
import { useState } from 'react'
import { cn } from '@/shared/utils'
import { toast } from 'react-hot-toast'
import * as Dialog from '@radix-ui/react-dialog'
import { Input, Skeleton } from '@/shared/ui'

export function BottomDock() {
  const [activeTab, setActiveTab] = useState('positions')
  const [isLoading, setIsLoading] = useState(false)
  const [closeAllDialogOpen, setCloseAllDialogOpen] = useState(false)
  const [closePositionDialogOpen, setClosePositionDialogOpen] = useState(false)
  const [closePositionId, setClosePositionId] = useState<string | null>(null)
  const [cancelOrderDialogOpen, setCancelOrderDialogOpen] = useState(false)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<{ type: 'position' | 'order'; id: string } | null>(null)

  const tabs = [
    { id: 'positions', label: 'Positions' },
    { id: 'orders', label: 'Orders' },
    { id: 'order-history', label: 'Order History' },
    { id: 'position-history', label: 'Position History' },
    { id: 'bot-positions', label: 'Bot Positions' },
  ]

  return (
    <div className="h-[300px] min-h-0 overflow-hidden flex flex-col border-t border-white/5 bg-gradient-to-b from-surface to-surface-2/30 shadow-lg shadow-black/10">
      {/* Tab Strip + Toolbar - Enhanced */}
      <div className="shrink-0 h-12 border-b border-white/5 flex items-center justify-between px-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 relative uppercase tracking-wider',
                activeTab === tab.id
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'text-muted hover:text-text hover:bg-surface-2/50'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white"></div>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'positions' && (
            <button
              onClick={() => toast.success('All positions closed successfully')}
              className="px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5 border border-transparent"
              title="Close All Positions"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>Close All</span>
            </button>
          )}
          <button
            onClick={() => toast.info('Column customization coming soon')}
            className="px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5"
            title="Customize Columns"
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Columns</span>
          </button>
          <button
            onClick={() => toast.success('Data exported successfully')}
            className="px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5"
            title="Export Data"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {activeTab === 'positions' && (
          <>
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" variant="text" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                  </div>
                ))}
              </div>
            ) : mockPositions.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No open positions</div>
                  <div className="text-xs mt-1">Open a position to see it here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Margin</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Current</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">P&L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">S/L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">T/P</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPositions.map((pos, index) => (
                    <tr 
                      key={pos.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id}</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
                      <td className="px-4 py-3 text-text font-medium">{pos.quantity}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-success/20 text-success font-bold text-[10px] uppercase tracking-wider">
                          {pos.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-semibold">${pos.margin}</td>
                      <td className="px-4 py-3 font-mono text-text font-medium">${pos.entry}</td>
                      <td className="px-4 py-3 font-mono text-success font-bold">${pos.current}</td>
                      <td className="px-4 py-3 font-mono text-success font-bold">+${pos.pnl}</td>
                      <td className="px-4 py-3 font-mono text-text/70">${pos.sl}</td>
                      <td className="px-4 py-3 font-mono text-text/70">${pos.tp}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditItem({ type: 'position', id: pos.id })
                              setEditDialogOpen(true)
                            }}
                            className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
                            title="Edit Position"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setClosePositionId(pos.id)
                              setClosePositionDialogOpen(true)
                            }}
                            className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95"
                            title="Close Position"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'orders' && (
          <>
            {mockOrders.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No open orders</div>
                  <div className="text-xs mt-1">Place an order to see it here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Created</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOrders.map((order, index) => (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-text font-semibold">{order.id}</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{order.symbol}</td>
                      <td className="px-4 py-3 text-text font-medium">{order.type}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.side === 'buy' 
                            ? 'bg-success/20 text-success' 
                            : 'bg-danger/20 text-danger'
                        )}>
                          {order.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{order.size}</td>
                      <td className="px-4 py-3 font-mono text-text">{order.price || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.status === 'filled' 
                            ? 'bg-success/20 text-success' 
                            : order.status === 'open' 
                            ? 'bg-info/20 text-info' 
                            : 'bg-muted/20 text-muted'
                        )}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{order.createdAt}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {order.status === 'open' && (
                            <>
                              <button
                                onClick={() => {
                                  setEditItem({ type: 'order', id: order.id })
                                  setEditDialogOpen(true)
                                }}
                                className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
                                title="Edit Order"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setCancelOrderId(order.id)
                                  setCancelOrderDialogOpen(true)
                                }}
                                className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95"
                                title="Cancel Order"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'order-history' && (
          <>
            {mockOrderHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No order history</div>
                  <div className="text-xs mt-1">Completed orders will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOrderHistory.map((order, index) => (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-text font-semibold">{order.id}</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{order.symbol}</td>
                      <td className="px-4 py-3 text-text font-medium">{order.type}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.side === 'buy' 
                            ? 'bg-success/20 text-success' 
                            : 'bg-danger/20 text-danger'
                        )}>
                          {order.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{order.size}</td>
                      <td className="px-4 py-3 font-mono text-text">{order.price || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-success/20 text-success font-bold text-[10px] uppercase tracking-wider">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{order.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'position-history' && (
          <>
            {mockPositionHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No position history</div>
                  <div className="text-xs mt-1">Closed positions will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Exit</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPositionHistory.map((pos, index) => (
                    <tr 
                      key={pos.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id}</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
                      <td className="px-4 py-3 text-text font-medium">{pos.quantity}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-success/20 text-success font-bold text-[10px] uppercase tracking-wider">
                          {pos.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-text font-medium">${pos.entry}</td>
                      <td className="px-4 py-3 font-mono text-text font-medium">${pos.current}</td>
                      <td className="px-4 py-3 font-mono text-success font-bold">+${pos.pnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'bot-positions' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted">
              <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <div className="text-sm font-medium">No bot positions</div>
              <div className="text-xs mt-1">Bot trading positions will appear here</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Stats Bar */}
      <div className="shrink-0 h-14 border-t border-white/5 bg-surface-2 flex items-center px-4 text-sm overflow-x-auto scrollbar-thin scrollbar-hide">
        <div className="flex items-center gap-4 min-w-max">
          <div className="flex items-center gap-1.5 shrink-0">
            <Wallet className="h-4 w-4 text-muted" />
            <span className="text-muted">Balance </span>
            <span className="text-text">$2,495.56</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingUp className="h-4 w-4 text-muted" />
            <span className="text-muted">Equity </span>
            <span className="text-text">$2,495.68</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Shield className="h-4 w-4 text-muted" />
            <span className="text-muted">Margin </span>
            <span className="text-text">$22.28</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <DollarSign className="h-4 w-4 text-muted" />
            <span className="text-muted">Free Margin </span>
            <span className="text-text">$2,473.40</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Gift className="h-4 w-4 text-muted" />
            <span className="text-muted">Bonus </span>
            <span className="text-text">$0.00</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Percent className="h-4 w-4 text-muted" />
            <span className="text-muted">Margin Level </span>
            <span className="text-text">11199.80%</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <span className="text-muted">RI PNL </span>
            <span className="text-success">$2,472.56</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowDownRight className="h-4 w-4 text-success" />
            <span className="text-muted">UnR Net PNL </span>
            <span className="text-success">$0.12</span>
          </div>
        </div>
      </div>

      {/* Close All Positions Dialog */}
      <Dialog.Root open={closeAllDialogOpen} onOpenChange={setCloseAllDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close All Positions
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
              Are you sure you want to close all open positions? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCloseAllDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success('All positions closed successfully')
                  setCloseAllDialogOpen(false)
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Close All
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Close Position Dialog */}
      <Dialog.Root open={closePositionDialogOpen} onOpenChange={setClosePositionDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close Position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
              Are you sure you want to close position {closePositionId}? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setClosePositionDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success(`Position ${closePositionId} closed successfully`)
                  setClosePositionDialogOpen(false)
                  setClosePositionId(null)
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Close Position
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Cancel Order Dialog */}
      <Dialog.Root open={cancelOrderDialogOpen} onOpenChange={setCancelOrderDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Cancel Order
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
              Are you sure you want to cancel order {cancelOrderId}? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCancelOrderDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success(`Order ${cancelOrderId} cancelled successfully`)
                  setCancelOrderDialogOpen(false)
                  setCancelOrderId(null)
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Cancel Order
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Edit Dialog */}
      <Dialog.Root open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-4">
              Edit {editItem?.type === 'position' ? 'Position' : 'Order'} {editItem?.id}
            </Dialog.Title>
            <div className="space-y-4 mb-6">
              {editItem?.type === 'position' ? (
                <>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Stop Loss</label>
                    <Input type="number" step="0.01" placeholder="Enter SL price" className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Take Profit</label>
                    <Input type="number" step="0.01" placeholder="Enter TP price" className="w-full" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Price</label>
                    <Input type="number" step="0.01" placeholder="Enter price" className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Size</label>
                    <Input type="number" step="0.000001" placeholder="Enter size" className="w-full" />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setEditDialogOpen(false)
                  setEditItem(null)
                }}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success(`${editItem?.type === 'position' ? 'Position' : 'Order'} ${editItem?.id} updated successfully`)
                  setEditDialogOpen(false)
                  setEditItem(null)
                }}
                className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent/90 rounded transition-colors"
              >
                Save Changes
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

