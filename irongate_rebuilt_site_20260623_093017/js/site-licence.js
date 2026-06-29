const IRONGATE_POOL_SAFETY_INSPECTOR_LICENCE = "PS15616387";

function updateVisibleLicenceNumber(root = document) {
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue && /PSI\s*000000/i.test(node.nodeValue)) textNodes.push(node);
  }

  textNodes.forEach((node) => {
    node.nodeValue = node.nodeValue.replace(/PSI\s*000000/gi, IRONGATE_POOL_SAFETY_INSPECTOR_LICENCE);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => updateVisibleLicenceNumber());
} else {
  updateVisibleLicenceNumber();
}
