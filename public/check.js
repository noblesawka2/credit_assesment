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
const purposeGuidance = document.querySelector('#purpose-guidance');
const productGuidance = document.querySelector('#product-guidance');
const calculationAvailability = document.querySelector('#calculation-availability');
let current = 0;
let products = [];
let purposeCatalog = [];
let guidanceProducts = [];
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

function option(value, text) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = text;
  return item;
}

function selectedPurpose() {
  return purposeCatalog.find(item => item.code === purpose.value);
}

function renderPurposeGuidance() {
  const selected = selectedPurpose();
  purposeGuidance.replaceChildren();
  if (!selected) return;
  const title = document.createElement('strong');
  title.textContent = selected.label;
  const description = document.createElement('p');
  description.textContent = selected.description;
  purposeGuidance.append(title, description);
}

function renderProductGuidance() {
  const suggestedCodes = selectedPurpose()?.suggestedProductCodes ?? [];
  const suggested = suggestedCodes.map(code => guidanceProducts.find(item => item.code === code)).filter(Boolean);
  productGuidance.replaceChildren();
  if (suggested.length === 0) return;
  const heading = document.createElement('strong');
  heading.textContent = suggested.length === 1 ? 'Suggested Nobles product to discuss' : 'Suggested Nobles products to discuss';
  productGuidance.append(heading);
  for (const item of suggested) {
    const card = document.createElement('section');
    card.className = 'product-suggestion';
    const title = document.createElement('h3');
    title.textContent = item.name;
    const summary = document.createElement('p');
    summary.textContent = item.summary;
    const details = document.createElement('p');
    details.textContent = item.repaymentPattern + '. ' + item.amountGuide + '.';
    card.append(title, summary, details);
    productGuidance.append(card);
  }
}

function updateProducts() {
  const candidates = products.filter(item => item.purposeCodes.includes(purpose.value));
  const previousValue = product.value;
  product.replaceChildren(option('', candidates.length ? 'Select a Nobles product' : 'Suggestion shown below - calculation policy pending'));
  for (const item of candidates) product.append(option(item.code, item.name));
  if (candidates.some(item => item.code === previousValue)) product.value = previousValue;
  else if (candidates.length === 1) product.value = candidates[0].code;
  product.disabled = candidates.length === 0;
  submit.disabled = !policiesAvailable || !product.value;
  calculationAvailability.textContent = candidates.length
    ? 'The selected purpose has an approved product policy available for this preliminary calculation. This remains a readiness indicator, not approval.'
    : 'The product suggestion below is guidance from Nobles public product information. A percentage cannot be calculated for this purpose until an approved executable product-purpose policy is available.';
  renderPurposeGuidance();
  renderProductGuidance();
}

async function loadConfiguration() {
  try {
    const response = await fetch('/api/public/readiness/config', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error('UNAVAILABLE');
    products = Array.isArray(data.products) ? data.products : [];
    purposeCatalog = Array.isArray(data.purposeCatalog) ? data.purposeCatalog : [];
    guidanceProducts = Array.isArray(data.guidanceProducts) ? data.guidanceProducts : [];
    purpose.replaceChildren(option('', 'Select a purpose'));
    for (const item of purposeCatalog) purpose.append(option(item.code, item.label));
    purpose.disabled = purposeCatalog.length === 0;
    policiesAvailable = data.status === 'AVAILABLE' && products.length > 0;
    if (!policiesAvailable) {
      policyStatus.textContent = 'You can explore Nobles purposes and answer the questions, but a live percentage and product plan remain unavailable until approved executable readiness policies are configured.';
      submit.textContent = 'Calculation unavailable';
      updateProducts();
      return;
    }
    updateProducts();
    policyStatus.textContent = 'Approved executable readiness policies are available. Your answers are used only for this calculation and are not saved.';
  } catch {
    policyStatus.textContent = 'The readiness service is temporarily unavailable. No answers have been sent or saved.';
    purpose.replaceChildren(option('', 'Purpose catalogue temporarily unavailable'));
    product.replaceChildren(option('SERVICE_PENDING', 'Product selection temporarily unavailable'));
    purpose.disabled = true;
    product.disabled = true;
    calculationAvailability.textContent = 'Product guidance and readiness calculation are temporarily unavailable.';
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
  const remark = document.querySelector('#result-remark');
  const plan = document.querySelector('#result-plan');
  const note = document.querySelector('#result-note');
  reasons.replaceChildren();
  plan.replaceChildren();
  plan.hidden = true;
  if (data.status === 'POLICY_CONFIGURATION_REQUIRED') {
    title.textContent = 'Live calculation is not currently available';
    score.textContent = '';
    remark.textContent = data.remark ?? '';
    note.textContent = 'Approved executable PRODUCT, SCORE and ELIGIBILITY policies are required before Nobles can show a readiness result.';
  } else {
    const titles = {
      READY_FOR_FORMAL_REVIEW: 'You may be ready for a formal review',
      NEEDS_ATTENTION: 'Some areas may need attention',
      NOT_CURRENTLY_READY: 'You may not be ready yet'
    };
    title.textContent = titles[data.status] ?? 'Preliminary readiness result';
    score.textContent = Number.isInteger(data.readinessPercentage) ? data.readinessPercentage + '% readiness indicator' : '';
    remark.textContent = data.remark ?? '';
    for (const text of Array.isArray(data.reasons) ? data.reasons : []) {
      const item = document.createElement('li');
      item.textContent = text;
      reasons.append(item);
    }
    if (data.suggestedPlan) {
      const heading = document.createElement('h3');
      heading.textContent = 'Suggested Nobles plan to discuss: ' + data.suggestedPlan.productName;
      const summary = document.createElement('p');
      summary.textContent = data.suggestedPlan.summary;
      const purposeText = document.createElement('p');
      purposeText.textContent = 'Purpose: ' + data.suggestedPlan.purpose;
      const repayment = document.createElement('p');
      repayment.textContent = data.suggestedPlan.repaymentPattern + '. ' + data.suggestedPlan.amountGuide + '.';
      const nextStep = document.createElement('p');
      nextStep.textContent = data.suggestedPlan.nextStep;
      plan.append(heading, summary, purposeText, repayment, nextStep);
      plan.hidden = false;
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
purpose.addEventListener('change', updateProducts);
product.addEventListener('change', renderProductGuidance);
restart.addEventListener('click', () => {
  form.reset();
  updateProducts();
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
    submit.disabled = !policiesAvailable || !product.value;
  }
});

showStep(0);
loadConfiguration();
