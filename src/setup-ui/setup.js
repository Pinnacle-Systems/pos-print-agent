(function () {
  "use strict";

  var NOT_CONFIGURED_VALUE = "";

  var ROLES = [
    {
      key: "receipt",
      printerSelectId: "receipt-printer",
      warningId: "receipt-printer-warning",
      languageId: "receipt-command-language",
      defaultLanguage: "ESC_POS",
      buildExtra: function () {
        var paperWidth = document.getElementById("receipt-paper-width").value;
        return { paperWidth: paperWidth };
      },
      applyExtra: function (mapping) {
        if (mapping && mapping.paperWidth) {
          document.getElementById("receipt-paper-width").value = mapping.paperWidth;
        }
      },
    },
    {
      key: "barcode-label",
      printerSelectId: "barcode-printer",
      warningId: "barcode-printer-warning",
      languageId: "barcode-command-language",
      defaultLanguage: "TSPL",
      buildExtra: function () {
        var width = document.getElementById("barcode-label-width").value.trim();
        var height = document.getElementById("barcode-label-height").value.trim();
        var extra = {};
        if (width) extra.labelWidth = width;
        if (height) extra.labelHeight = height;
        return extra;
      },
      applyExtra: function (mapping) {
        document.getElementById("barcode-label-width").value = (mapping && mapping.labelWidth) || "";
        document.getElementById("barcode-label-height").value = (mapping && mapping.labelHeight) || "";
      },
    },
    {
      key: "a4-invoice",
      printerSelectId: "a4-printer",
      warningId: "a4-printer-warning",
      languageId: "a4-command-language",
      defaultLanguage: "PDF",
      buildExtra: function () {
        return {};
      },
      applyExtra: function () {},
    },
    {
      key: "cash-drawer",
      printerSelectId: "cash-drawer-printer",
      warningId: "cash-drawer-printer-warning",
      languageId: null,
      defaultLanguage: "ESC_POS",
      buildExtra: function () {
        return {};
      },
      applyExtra: function () {},
    },
  ];

  var state = {
    printers: [],
    config: null,
  };

  function apiFetch(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () {
        return null;
      }).then(function (body) {
        if (!res.ok) {
          var message = (body && body.message) || ("Request failed with status " + res.status);
          var error = new Error(message);
          error.errorCode = body && body.errorCode;
          error.status = res.status;
          throw error;
        }
        return body;
      });
    });
  }

  function showMessage(type, text) {
    var banner = document.getElementById("message-banner");
    banner.textContent = text;
    banner.className = "banner " + type;
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearMessage() {
    var banner = document.getElementById("message-banner");
    banner.className = "banner hidden";
    banner.textContent = "";
  }

  function loadHealth() {
    return apiFetch("/health")
      .then(function (health) {
        document.getElementById("status-value").textContent = health.status === "ok" ? "OK" : health.status;
        document.getElementById("status-version").textContent = health.version || "-";
        document.getElementById("status-machine-name").textContent = health.machineName || "-";
        document.getElementById("status-configured").textContent = health.configured ? "Yes" : "No";
      })
      .catch(function (err) {
        document.getElementById("status-value").textContent = "Unreachable";
        showMessage("error", "Could not load agent status: " + err.message);
      });
  }

  function loadPrinters() {
    return apiFetch("/printers").then(function (data) {
      state.printers = data.printers || [];
    });
  }

  function loadConfig() {
    return apiFetch("/config").then(function (config) {
      state.config = config;
      document.getElementById("machine-code").value = config.machineCode || "";
    });
  }

  function populatePrinterSelect(role) {
    var select = document.getElementById(role.printerSelectId);
    var warning = document.getElementById(role.warningId);
    var mapping = state.config.printerMappings[role.key];
    var configuredPrinterName = mapping ? mapping.windowsPrinterName : "";

    select.innerHTML = "";

    var blankOption = document.createElement("option");
    blankOption.value = NOT_CONFIGURED_VALUE;
    blankOption.textContent = "-- Not configured --";
    select.appendChild(blankOption);

    var installedNames = {};
    state.printers.forEach(function (printer) {
      installedNames[printer.name] = true;
      var option = document.createElement("option");
      option.value = printer.name;
      option.textContent = printer.name + (printer.isDefault ? " (Windows default)" : "");
      select.appendChild(option);
    });

    if (configuredPrinterName && !installedNames[configuredPrinterName]) {
      var missingOption = document.createElement("option");
      missingOption.value = configuredPrinterName;
      missingOption.textContent = configuredPrinterName + " (not currently installed)";
      select.appendChild(missingOption);
    }

    select.value = configuredPrinterName || NOT_CONFIGURED_VALUE;

    if (configuredPrinterName && !installedNames[configuredPrinterName]) {
      warning.textContent =
        'Configured printer "' + configuredPrinterName + '" was not found on this machine. Reselect a printer or plug it back in and click Refresh Printer List.';
      warning.classList.remove("hidden");
    } else {
      warning.classList.add("hidden");
      warning.textContent = "";
    }

    if (role.languageId) {
      var languageSelect = document.getElementById(role.languageId);
      languageSelect.value = (mapping && mapping.commandLanguage) || role.defaultLanguage;
    }

    role.applyExtra(mapping);
  }

  function renderForm() {
    ROLES.forEach(populatePrinterSelect);
    document.getElementById("printers-loaded-hint").textContent =
      state.printers.length + " printer(s) found on this machine.";
  }

  function buildPrinterMappingsPayload() {
    var mappings = {};

    ROLES.forEach(function (role) {
      var select = document.getElementById(role.printerSelectId);
      var windowsPrinterName = select.value;

      if (!windowsPrinterName) {
        return;
      }

      var existing = state.config.printerMappings[role.key];
      var commandLanguage = role.languageId
        ? document.getElementById(role.languageId).value
        : role.defaultLanguage;

      var mapping = {
        windowsPrinterName: windowsPrinterName,
        commandLanguage: commandLanguage,
        template: (existing && existing.template) || role.key + "-default",
      };

      var extra = role.buildExtra();
      Object.keys(extra).forEach(function (key) {
        if (extra[key]) {
          mapping[key] = extra[key];
        }
      });

      mappings[role.key] = mapping;
    });

    return mappings;
  }

  function refreshPrinters() {
    clearMessage();
    var button = document.getElementById("refresh-printers-btn");
    button.disabled = true;
    return loadPrinters()
      .then(function () {
        renderForm();
      })
      .catch(function (err) {
        showMessage("error", "Could not refresh printer list: " + err.message);
      })
      .finally(function () {
        button.disabled = false;
      });
  }

  function saveConfiguration(event) {
    event.preventDefault();
    clearMessage();

    var button = document.getElementById("save-config-btn");
    button.disabled = true;

    var payload = { printerMappings: buildPrinterMappingsPayload() };

    return apiFetch("/config/printer-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (updatedConfig) {
        state.config = updatedConfig;
        renderForm();
        showMessage("success", "Configuration saved.");
        return loadHealth();
      })
      .catch(function (err) {
        showMessage("error", "Could not save configuration: " + err.message);
      })
      .finally(function () {
        button.disabled = false;
      });
  }

  function testPrint(role) {
    clearMessage();

    var roleConfig = ROLES.filter(function (r) {
      return r.key === role;
    })[0];
    var select = document.getElementById(roleConfig.printerSelectId);
    var savedMapping = state.config.printerMappings[role];

    if (!savedMapping) {
      showMessage("error", "Select and save a printer for this role before testing.");
      return;
    }

    if (select.value !== savedMapping.windowsPrinterName) {
      showMessage("error", "You have unsaved changes for this role. Click Save Configuration first, then test.");
      return;
    }

    apiFetch("/test-print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role }),
    })
      .then(function (result) {
        showMessage("success", "Test print sent to " + result.printerName + ".");
      })
      .catch(function (err) {
        showMessage("error", "Test print failed: " + err.message);
      });
  }

  function init() {
    Promise.all([loadHealth(), loadPrinters(), loadConfig()])
      .then(function () {
        renderForm();
      })
      .catch(function (err) {
        showMessage("error", "Could not load setup page data: " + err.message);
      });

    document.getElementById("refresh-printers-btn").addEventListener("click", refreshPrinters);
    document.getElementById("printer-config-form").addEventListener("submit", saveConfiguration);

    var testButtons = document.querySelectorAll(".test-btn");
    testButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        testPrint(btn.getAttribute("data-role"));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
