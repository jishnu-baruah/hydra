// Demo Swap: the one script of ours. Hydra hashes this file and the vendor script it loads.
const RATE = 1850
const amount = document.getElementById('amount')
const out = document.getElementById('out')
const status = document.getElementById('status')

function quote() {
  out.value = (Number(amount.value || 0) * RATE).toFixed(2)
  status.textContent = `Quote at ${dayjs().format('HH:mm:ss')} (demo rate ${RATE})`
}

amount.addEventListener('input', quote)
document.getElementById('swap').addEventListener('click', () => {
  status.textContent = 'Demo only: nothing was sent.'
})
quote()
