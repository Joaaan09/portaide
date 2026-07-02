// Placeholder mínimo para validar tokens y fuentes.
// El shell móvil real (isla dinámica + 5 vistas) llega en la siguiente subtarea.
export default function App() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--accent)',
          }}
        >
          PortaIDE
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--dim)' }}>
          Portable IDE — scaffolding listo
        </p>
        <code style={{ display: 'block', marginTop: 16, fontSize: 13, color: 'var(--green)' }}>
          <span style={{ color: 'var(--faint)' }}>~/servers/portaide</span> ❯{' '}
          <span style={{ color: 'var(--text)' }}>claude</span>{' '}
          <span style={{ color: 'var(--accent)' }}>▮</span>
        </code>
      </div>
    </main>
  )
}
