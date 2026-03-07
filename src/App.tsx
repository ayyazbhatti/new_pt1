import { AppRouter } from './app/router'
import { useRefreshUserOnFocus } from './shared/hooks/useRefreshUserOnFocus'

function App() {
  useRefreshUserOnFocus()
  return <AppRouter />
}

export default App
