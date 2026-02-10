import { useModalStore } from '@/app/store'
import { ModalShell } from '@/shared/ui/modal'
import { useEffect, useState } from 'react'
import { ReactNode } from 'react'

interface ModalItemProps {
  modalKey: string
  component: ReactNode
  props?: Record<string, unknown>
}

function ModalItem({ modalKey, component, props }: ModalItemProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!open) {
      closeModal(modalKey)
    }
  }, [open, modalKey, closeModal])

  return (
    <ModalShell
      open={open}
      onOpenChange={setOpen}
      {...(props as any)}
    >
      {component}
    </ModalShell>
  )
}

export function ModalHost() {
  const modals = useModalStore((state) => state.modals)

  return (
    <>
      {Object.entries(modals).map(([key, { component, props }]) => (
        <ModalItem
          key={key}
          modalKey={key}
          component={component}
          props={props}
        />
      ))}
    </>
  )
}

