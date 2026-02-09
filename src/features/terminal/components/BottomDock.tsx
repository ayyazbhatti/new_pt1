import { Columns, Download, Wallet, TrendingUp, Shield, DollarSign, Gift, Percent, ArrowUpRight, ArrowDownRight, X, Edit, Trash2, XCircle, Package, FileText, History, Bot, AlertCircle } from 'lucide-react'
import { mockPositions, mockOrders, mockOrderHistory, mockPositionHistory } from '@/shared/mock/terminalMock'
import { useState } from 'react'
import { cn } from '@/shared/utils'
import { toast } from 'react-hot-toast'
import * as Dialog from '@radix-ui/react-dialog'
import { Input } from '@/shared/ui'

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
    <div className="h-[300px] min-h-0 overflow-hidden flex flex-col border-t border-border bg-surface">
      {/* Tab Strip + Toolbar */}
      <div className="shrink-0 h-10 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-text'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'positions' && (
            <button
              onClick={() => toast.success('All positions closed successfully')}
              className="px-3 py-1.5 text-sm text-danger hover:bg-danger/20 rounded transition-colors flex items-center gap-1.5"
              title="Close All Positions"
            >
              <XCircle className="h-4 w-4 text-danger stroke-current" strokeWidth={2} />
              <span>Close All</span>
            </button>
          )}
          <button
            onClick={() => toast.info('Column customization coming soon')}
            className="px-3 py-1.5 text-sm text-text hover:bg-surface-2 rounded transition-colors flex items-center gap-1.5"
            title="Customize Columns"
          >
            <Columns className="h-4 w-4 text-text stroke-current" strokeWidth={2} />
            <span>Columns</span>
          </button>
          <button
            onClick={() => toast.success('Data exported successfully')}
            className="px-3 py-1.5 text-sm text-text hover:bg-surface-2 rounded transition-colors flex items-center gap-1.5"
            title="Export Data"
          >
            <Download className="h-4 w-4 text-text stroke-current" strokeWidth={2} />
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
              <table className="w-full text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">ID</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Symbol</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Quantity</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Direction</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Margin</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Entry</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Current</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">P&L</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">S/L</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">T/P</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPositions.map((pos) => (
                    <tr key={pos.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2 text-text">{pos.id}</td>
                      <td className="px-3 py-2 text-text">{pos.symbol}</td>
                      <td className="px-3 py-2 text-text">{pos.quantity}</td>
                      <td className="px-3 py-2">
                        <span className="text-success">{pos.direction}</span>
                      </td>
                      <td className="px-3 py-2 text-text">${pos.margin}</td>
                      <td className="px-3 py-2 text-text">${pos.entry}</td>
                      <td className="px-3 py-2 text-success">${pos.current}</td>
                      <td className="px-3 py-2 text-success">+${pos.pnl}</td>
                      <td className="px-3 py-2 text-text">${pos.sl}</td>
                      <td className="px-3 py-2 text-text">${pos.tp}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditItem({ type: 'position', id: pos.id })
                              setEditDialogOpen(true)
                            }}
                            className="p-1.5 hover:bg-accent/20 rounded transition-colors text-accent hover:text-accent/80"
                            title="Edit Position"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setClosePositionId(pos.id)
                              setClosePositionDialogOpen(true)
                            }}
                            className="p-1.5 hover:bg-danger/20 rounded transition-colors text-danger hover:text-danger/80"
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
              <table className="w-full text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">ID</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Symbol</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Type</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Side</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Size</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Price</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Status</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Created</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOrders.map((order) => (
                    <tr key={order.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2 text-text">{order.id}</td>
                      <td className="px-3 py-2 text-text">{order.symbol}</td>
                      <td className="px-3 py-2 text-text">{order.type}</td>
                      <td className="px-3 py-2">
                        <span className={order.side === 'buy' ? 'text-success' : 'text-danger'}>
                          {order.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text">{order.size}</td>
                      <td className="px-3 py-2 text-text">{order.price || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={order.status === 'filled' ? 'text-success' : order.status === 'open' ? 'text-info' : 'text-muted'}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text">{order.createdAt}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {order.status === 'open' && (
                            <>
                              <button
                                onClick={() => {
                                  setEditItem({ type: 'order', id: order.id })
                                  setEditDialogOpen(true)
                                }}
                                className="p-1.5 hover:bg-accent/20 rounded transition-colors text-accent hover:text-accent/80"
                                title="Edit Order"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setCancelOrderId(order.id)
                                  setCancelOrderDialogOpen(true)
                                }}
                                className="p-1.5 hover:bg-danger/20 rounded transition-colors text-danger hover:text-danger/80"
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
              <table className="w-full text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">ID</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Symbol</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Type</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Side</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Size</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Price</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Status</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {mockOrderHistory.map((order) => (
                    <tr key={order.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2 text-text">{order.id}</td>
                      <td className="px-3 py-2 text-text">{order.symbol}</td>
                      <td className="px-3 py-2 text-text">{order.type}</td>
                      <td className="px-3 py-2">
                        <span className={order.side === 'buy' ? 'text-success' : 'text-danger'}>
                          {order.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text">{order.size}</td>
                      <td className="px-3 py-2 text-text">{order.price || '-'}</td>
                      <td className="px-3 py-2">
                        <span className="text-success">{order.status}</span>
                      </td>
                      <td className="px-3 py-2 text-text">{order.createdAt}</td>
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
              <table className="w-full text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">ID</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Symbol</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Quantity</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Direction</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Entry</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">Exit</th>
                    <th className="px-3 py-2 text-left text-muted uppercase font-semibold">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPositionHistory.map((pos) => (
                    <tr key={pos.id} className="border-b border-border hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2 text-text">{pos.id}</td>
                      <td className="px-3 py-2 text-text">{pos.symbol}</td>
                      <td className="px-3 py-2 text-text">{pos.quantity}</td>
                      <td className="px-3 py-2">
                        <span className="text-success">{pos.direction}</span>
                      </td>
                      <td className="px-3 py-2 text-text">${pos.entry}</td>
                      <td className="px-3 py-2 text-text">${pos.current}</td>
                      <td className="px-3 py-2 text-success">+${pos.pnl}</td>
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
      <div className="shrink-0 h-14 border-t border-border bg-surface-2 flex items-center px-4 text-sm overflow-x-auto scrollbar-thin scrollbar-hide">
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

