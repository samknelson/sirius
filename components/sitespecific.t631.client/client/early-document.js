(function () {
  if (window.location.pathname !== "/sitespecific/t631/arrive") return;
  var arrivalParams = new URLSearchParams(window.location.search);
  var arrivalToken = arrivalParams.get("token");
  var referrerMeta = document.createElement("meta");
  referrerMeta.name = "referrer";
  referrerMeta.content = "no-referrer";
  document.head.appendChild(referrerMeta);
  window.__t631ArrivalCredentials = {
    workerId: arrivalParams.get("worker_id") || "",
    token: arrivalToken || "",
  };
  if (arrivalToken !== null) {
    arrivalParams.delete("token");
    var arrivalQuery = arrivalParams.toString();
    window.history.replaceState(
      window.history.state, "",
      window.location.pathname + (arrivalQuery ? "?" + arrivalQuery : "") + window.location.hash,
    );
  }
})();
