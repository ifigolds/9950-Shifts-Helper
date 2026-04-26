import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Mini app render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="boot-screen" dir="rtl">
          <div className="boot-card">
            <h1>משהו השתבש בתצוגה</h1>
            <p className="subtitle">הנתונים נשמרו. נסה לפתוח מחדש את המערכת או לרענן את המסך.</p>
            <button onClick={() => window.location.reload()}>רענן</button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
