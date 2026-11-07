import { passwordStrength } from '../lib/crypto'

interface PasswordStrengthProps {
  entropy: number
  showEntropy?: boolean
}

export function PasswordStrength({ entropy, showEntropy = false }: PasswordStrengthProps) {
  const strength = passwordStrength(entropy)

  return (
    <div className={`strength strength--${strength.score}`}>
      <div className="strength__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`strength__bar ${index <= strength.score - 1 ? 'is-on' : ''}`}
          />
        ))}
      </div>
      <div className="strength__meta">
        <span>{strength.label}</span>
        {showEntropy && <span className="strength__entropy">≈ {entropy} bits</span>}
      </div>
    </div>
  )
}
