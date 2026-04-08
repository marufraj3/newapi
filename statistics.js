const container = document.getElementById('orders-wrapper');
const paginationContainer = document.getElementById('orders-pagination');
const itemsPerPage = 100;
let allCompletedOrders = [];
let filteredOrders = [];
let currentPage = 1;
let isSearchActive = false;
let initialServiceId = null;

// Get service_id from URL
const urlParams = new URLSearchParams(window.location.search);
const serviceIdFromUrl = urlParams.get('service_id');
if (serviceIdFromUrl) {
  initialServiceId = serviceIdFromUrl.trim();
}

// ✅ Updated to Vercel API
const baseUrl       = 'https://newapi-gamma-five.vercel.app/api/completed-orders';
const detailBaseUrl = 'https://newapi-gamma-five.vercel.app/api/order-detail';

// Fetch completed_time progressively
async function fetchCompletedTimeForOrders(orderElements) {
  if (orderElements.length === 0) return;

  const concurrency = 5;
  let index = 0;

  const worker = async () => {
    if (index >= orderElements.length) return;

    const { orderId, el } = orderElements[index++];
    el.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

    try {
      const res  = await fetch(`${detailBaseUrl}?id=${orderId}`);
      const data = await res.json();

      if (data?.data?.created && data?.data?.last_update) {
        const created = new Date(data.data.created);
        const updated = new Date(data.data.last_update);
        if (!isNaN(created) && !isNaN(updated)) {
          const diffMs = updated - created;
          const mins   = Math.floor(diffMs / 60000);
          const secs   = Math.floor((diffMs % 60000) / 1000);
          el.textContent = `${mins} Minutes ${secs} Seconds`;
          return;
        }
      }
      el.textContent = 'N/A';
    } catch (err) {
      el.textContent = 'N/A';
    } finally {
      worker();
    }
  };

  for (let i = 0; i < concurrency; i++) {
    worker();
  }
}

async function loadAllCompletedOrders() {
  const loader   = document.getElementById('orders-loader');
  const notFound = document.getElementById('nothing-found');

  if (loader)             loader.style.display = 'block';
  if (container)          container.style.display = 'none';
  if (notFound)           notFound.style.display = 'none';
  if (paginationContainer) paginationContainer.style.display = 'none';

  const limit    = 1000;
  const maxPages = 10;
  allCompletedOrders = [];

  for (let i = 0; i < maxPages; i++) {
    try {
      const url = `${baseUrl}?limit=${limit}&offset=${i * limit}&sort=date-desc`
        + (initialServiceId ? `&service_id=${encodeURIComponent(initialServiceId)}` : '');

      const res  = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      const list = data?.data?.list || [];
      if (list.length === 0) break;
      allCompletedOrders.push(...list);
      if (list.length < limit) break; // last page
    } catch (e) {
      break;
    }
  }

  if (loader) loader.style.display = 'none';

  if (allCompletedOrders.length === 0) {
    if (notFound) {
      notFound.style.display  = 'block';
      container.style.display = 'none';
    }
    return;
  }

  filteredOrders  = [];
  isSearchActive  = false;
  currentPage     = 1;
  renderPage(currentPage);
  setupSearch();
}

function renderPage(page) {
  container.innerHTML = '';
  const start          = (page - 1) * itemsPerPage;
  const end            = start + itemsPerPage;
  const ordersToDisplay = isSearchActive ? filteredOrders : allCompletedOrders;
  const pageItems      = ordersToDisplay.slice(start, end);
  const notFound       = document.getElementById('nothing-found');

  if (pageItems.length === 0) {
    if (notFound) notFound.style.display = 'block';
    container.style.display          = 'none';
    paginationContainer.style.display = 'none';
    return;
  }

  notFound.style.display            = 'none';
  container.style.display           = 'block';
  paginationContainer.style.display = 'flex';

  const timeElements = [];

  pageItems.forEach(order => {
    let createdDate = 'N/A';
    if (typeof order.created === 'string') {
      try { createdDate = new Date(order.created).toLocaleString(); }
      catch (e) { createdDate = order.created; }
    }

    const orderId     = order.id            || 'N/A';
    const serviceId   = order.service_id    || 'N/A';
    const serviceName = order.service_name  || 'Unknown Service';
    const quantity    = Number(order.quantity)       || 0;
    const chargeValue = Number(order.charge?.value)  || 0;
    const pricePer1k  = quantity > 0
      ? (chargeValue / quantity * 1000).toFixed(4)
      : '0.0000';

    const card = document.createElement('div');
    card.className = 'card services-card';
    card.innerHTML = `
      <div class="sc-block">
        <div class="sc-first">
          <div class="sc-id">${orderId}</div>
          <div class="sc-name">
            <span class="badge">${serviceId}</span> - 
            <span>${serviceName}</span>
          </div>
        </div>
        <div class="sc-last">
          <div class="sc-price"><span class="price">$${pricePer1k}</span></div>
        </div>
      </div>
      <div class="sc-block">
        <div class="oc-alt-first">
          <div class="oc-item">
            <span>
              <span class="icon"><i class="far fa-sort-amount-up primary-color"></i></span>
              <span class="text"><span class="primary-color">Quantity:</span> <span>${quantity}</span></span>
            </span>
          </div>
          <div class="oc-item">
            <span>
              <span class="icon"><i class="far fa-calendar-check primary-color"></i></span>
              <span class="text"><span class="primary-color">Created:</span> <span>${createdDate}</span></span>
            </span>
          </div>
          <span class="oc-item oc-link">
            <span>
              <span class="icon"><i class="far fa-stopwatch primary-color"></i></span>
              <span class="text"><span class="primary-color">Average Time:</span> <span id="time-${orderId}">Loading...</span></span>
            </span>
          </span>
        </div>
        <div class="sc-alt-last">
          <a href="/?select_service_id=${encodeURIComponent(serviceId)}" class="btn btn-primary">
            <span class="btn-text">Buy now</span>
            <span class="btn-icon"><i class="far fa-shopping-bag"></i></span>
          </a>
        </div>
      </div>
    `;
    container.appendChild(card);
    timeElements.push({ orderId, el: card.querySelector(`#time-${orderId}`) });
  });

  fetchCompletedTimeForOrders(timeElements);
  renderPaginationButtons();
}

function renderPaginationButtons() {
  paginationContainer.innerHTML = '';
  const ordersToPage = isSearchActive ? filteredOrders : allCompletedOrders;
  const totalPages   = Math.ceil(ordersToPage.length / itemsPerPage);

  if (totalPages <= 1) {
    paginationContainer.style.display = 'none';
    return;
  }

  if (currentPage > 1) {
    const prev = document.createElement('li');
    prev.className = 'page-item pi-pn';
    prev.innerHTML = `<a class="page-link" href="#">«</a>`;
    prev.onclick   = e => { e.preventDefault(); currentPage--; renderPage(currentPage); };
    paginationContainer.appendChild(prev);
  }

  const range = 3;
  let start = Math.max(1, currentPage - range);
  let end   = Math.min(totalPages, currentPage + range);
  if (currentPage <= 2)              { start = 1; end = Math.min(7, totalPages); }
  else if (currentPage >= totalPages - 1) { start = Math.max(1, totalPages - 6); end = totalPages; }

  for (let i = start; i <= end; i++) {
    const li = document.createElement('li');
    li.className = `page-item ${i === currentPage ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
    li.onclick   = e => { e.preventDefault(); currentPage = i; renderPage(currentPage); };
    paginationContainer.appendChild(li);
  }

  if (currentPage < totalPages) {
    const next = document.createElement('li');
    next.className = 'page-item pi-pn';
    next.innerHTML = `<a class="page-link" href="#">»</a>`;
    next.onclick   = e => { e.preventDefault(); currentPage++; renderPage(currentPage); };
    paginationContainer.appendChild(next);
  }
}

function setupSearch() {
  const searchInput = document.getElementById('order-search');
  if (!searchInput) return;

  const debounce = (fn, delay) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
  };

  const performSearch = () => {
    const term     = searchInput.value.trim().toLowerCase();
    isSearchActive = term !== '';
    filteredOrders = isSearchActive
      ? allCompletedOrders.filter(order => {
          const id   = (order.id           || '').toString().toLowerCase();
          const name = (order.service_name || '').toLowerCase();
          const sid  = (order.service_id   || '').toString().toLowerCase();
          return id.includes(term) || name.includes(term) || sid.includes(term);
        })
      : [];
    currentPage = 1;
    renderPage(currentPage);
  };

  searchInput.addEventListener('input', debounce(performSearch, 300));
}

document.addEventListener('DOMContentLoaded', loadAllCompletedOrders);
