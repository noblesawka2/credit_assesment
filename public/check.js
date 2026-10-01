const form = document.querySelector('#public-readiness-form');
const steps = [...document.querySelectorAll('.check-step')];
const progressItems = [...document.querySelectorAll('#check-steps li')];
const policyStatus = document.querySelector('#policy-status');
const formMessage = document.querySelector('#form-message');
const previous = document.querySelector('#previous-step');
const next = document.querySelector('#next-step');
const submit = document.querySelector('#submit-check');
const restart = document.querySelector('#restart-check');
const product = document.querySelector('#product-code');
const purpose = document.querySelector('#purpose-code');
let current = 0;
let products = [];
let policiesAvailable = false;

function showStep(index) {
  current = index;
  steps.forEach((step, position) => { step.hidden = position !== index; });
  progressItems.forEach((item, position) => {
    if (position === index) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  previous.hidden = index === 0 || index === 5;
  next.hidden = index >= 4;
  submit.hidden = index !== 4;
  restart.hidden = index !== 5;
  formMessage.textContent = '';
  steps[index].focus?.();
}

function inputsForStep(index) {
  return [...steps[index].querySelectorAll('input,select')];
}

function validStep(index) {
  for (const input of inputsForStep(index)) {
    if (!input.reportValidity()) return false;
  }
  return true;
}

function label(code) {
  return code.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function option(value, text) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = text;
  return item;
}

function updatePurposes() {
  const selected = products.find(item => item.code === product.value);
  const codes = selected?.purposeCodes ?? [...new Set(products.flatMap(item => item.purposeCodes))];
  const previousValue = purpose.value;
  purpose.replaceChildren(option('', 'Select a purpose'));
  for (const code of codes) purpose.append(option(code, label(code)));
  if (codes.includes(previousValue)) purpose.value = previousValue;
  purpose.disabled = codes.length === 0;
}

async function loadConfiguration() {
  try {
    const response = await fetch('/api/public/readiness/config', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error('UNAVAILABLE');
    products = Array.isArray(data.products) ? data.products : [];
    policiesAvailable = data.status === 'AVAILABLE' && products.length > 0;
    if (!policiesAvailable) {
      policyStatus.textContent = 'A live result is not available because approved executable readiness policies are not configured. You may review the questions, but Nobles will not fabricate a score.';
      purpose.replaceChildren(option('POLICY_PENDING', 'Purpose selection awaiting approved policy'));
      product.replaceChildren(option('POLICY_PENDING', 'Product selection awaiting approved policy'));
      purpose.disabled = false;
      product.disabled = false;
      submit.textContent = 'Calculation unavailable';
      return;
    }
    product.replaceChildren(option('', 'Select a product'));
    for (const item of products) product.append(option(item.code, item.name));
    product.disabled = false;
    updatePurposes();
    policyStatus.textContent = 'Approved executable readiness policies are available. Your answers are used only for this calculation and are not saved.';
    submit.disabled = false;
  } catch {
    policyStatus.textContent = 'The readiness service is temporarily unavailable. No answers have been sent or saved.';
    purpose.replaceChildren(option('SERVICE_PENDING', 'Purpose selection temporarily unavailable'));
    product.replaceChildren(option('SERVICE_PENDING', 'Product selection temporarily unavailable'));
    purpose.disabled = false;
    product.disabled = false;
    submit.textContent = 'Calculation unavailable';
  }
}

function kobo(id) {
  const value = document.querySelector(id).value.trim();
  if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(value)) throw new Error('INVALID_AMOUNT');
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
}

function requestBody() {
  return {
    productCode: product.value,
    purposeCode: purpose.value,
    incomeType: document.querySelector('#income-type').value,
    monthlyIncomeKobo: kobo('#monthly-income'),
    monthlyBusinessCostsKobo: kobo('#business-costs'),
    monthlyHouseholdExpensesKobo: kobo('#household-expenses'),
    monthlyOtherCommitmentsKobo: kobo('#other-commitments'),
    monthlyExistingRepaymentsKobo: kobo('#existing-repayments'),
    requestedAmountKobo: kobo('#requested-amount')
  };
}

function renderResult(data) {
  const title = document.querySelector('#result-title');
  const score = document.querySelector('#result-score');
  const reasons = document.querySelector('#result-reasons');
  const note = document.querySelector('#result-note');
  reasons.replaceChildren();
  if (data.status === 'POLICY_CONFIGURATION_REQUIRED') {
    title.textContent = 'Live calculation is not currently available';
    score.textContent = '';
    note.textContent = 'Approved executable PRODUCT, SCORE and ELIGIBILITY policies are required before Nobles can show a readiness result.';
  } else {
    const titles = {
      READY_FOR_FORMAL_REVIEW: 'You may be ready for a formal review',
      NEEDS_ATTENTION: 'Some areas may need attention',
      NOT_CURRENTLY_READY: 'You may not be ready yet'
    };
    title.textContent = titles[data.status] ?? 'Preliminary readiness result';
    score.textContent = Number.isInteger(data.readinessPercentage) ? data.readinessPercentage + '% readiness indicator' : '';
    for (const text of Array.isArray(data.reasons) ? data.reasons : []) {
      const item = document.createElement('li');
      item.textContent = text;
      reasons.append(item);
    }
    note.textContent = 'This is not approval, an offer, a guarantee or a final eligible amount. Speak with a Nobles officer for a formal assessment.';
  }
  showStep(5);
  document.querySelector('#check-result').focus();
}

next.addEventListener('click', () => {
  if (validStep(current)) showStep(current + 1);
});
previous.addEventListener('click', () => showStep(current - 1));
product.addEventListener('change', updatePurposes);
restart.addEventListener('click', () => {
  form.reset();
  if (policiesAvailable) updatePurposes();
  showStep(0);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!policiesAvailable || !validStep(4)) return;
  submit.disabled = true;
  formMessage.textContent = 'Calculating your preliminary readiness…';
  try {
    const response = await fetch('/api/public/readiness/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'UNAVAILABLE');
    renderResult(data);
  } catch (error) {
    formMessage.textContent = error.message === 'INVALID_AMOUNT'
      ? 'Enter each amount in naira using no more than two decimal places.'
      : 'We could not complete the check. No answers were saved. Please try again later.';
  } finally {
    submit.disabled = !policiesAvailable;
  }
});

showStep(0);
loadConfiguration();
