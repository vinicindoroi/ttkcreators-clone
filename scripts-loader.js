(function () {
  var script = document.currentScript;
  var src = script && script.dataset.src;
  if (!src) return;

  var JS_TYPES = /^(application\/(x-)?(ecma|java)script|text\/((x-)?(ecma|java)script|javascript1\.[0-5]|jscript|livescript))$/;
  var ours = new WeakSet();
  var written = [];

  function firesLoad(el) {
    if (!el.hasAttribute("src") || el.noModule) return false;
    var type = el.getAttribute("type");
    if (type === null) type = el.getAttribute("language") ? "text/" + el.getAttribute("language") : "";
    type = type.trim().toLowerCase();
    return type === "" || type === "module" || JS_TYPES.test(type);
  }

  function fired(type) {
    var nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return document.readyState === "complete";
    return (type === "load" ? nav.loadEventStart : nav.domContentLoadedEventStart) > 0;
  }

  function mine() {
    return !document.currentScript || ours.has(document.currentScript);
  }

  function parse(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
  }

  function patch() {
    var write = document.write;
    var writeln = document.writeln;
    var docAdd = document.addEventListener;
    var winAdd = window.addEventListener;

    function late(add) {
      return function (type, listener, options) {
        add.call(this, type, listener, options);
        var missed = type === "DOMContentLoaded" ? fired(type) : type === "load" && this === window && fired(type);
        if (!missed || !listener || !mine()) return;
        var target = this;
        setTimeout(function () {
          var event = new Event(type);
          if (typeof listener === "function") listener.call(target, event);
          else listener.handleEvent(event);
        });
      };
    }

    document.write = function () {
      if (!mine()) return write.apply(document, arguments);
      written.push(Array.prototype.join.call(arguments, ""));
    };
    document.writeln = function () {
      if (!mine()) return writeln.apply(document, arguments);
      written.push(Array.prototype.join.call(arguments, "") + "\n");
    };
    document.addEventListener = late(docAdd);
    window.addEventListener = late(winAdd);

    return function restore() {
      document.write = write;
      document.writeln = writeln;
      document.addEventListener = docAdd;
      window.addEventListener = winAdd;
    };
  }

  fetch(src)
    .then(function (res) {
      if (!res.ok) throw new Error(src + " " + res.status);
      return res.text();
    })
    .then(function (html) {
      var content = parse(html);
      var queue = Array.prototype.slice.call(content.querySelectorAll("script"));
      if (script.parentNode) script.parentNode.insertBefore(content, script);
      else document.head.appendChild(content);
      var restore = patch();

      (function next() {
        var old = queue.shift();
        if (!old) return restore();
        var el = document.createElement("script");
        Array.prototype.forEach.call(old.attributes, function (a) {
          el.setAttribute(a.name, a.value);
        });
        el.text = old.text;
        ours.add(el);
        var marker = document.createTextNode("");
        old.parentNode.insertBefore(marker, old.nextSibling);
        var onload = window.onload;

        function done() {
          if (window.onload !== onload && typeof window.onload === "function" && fired("load")) {
            setTimeout(window.onload.bind(window, new Event("load")));
          }
          var output = parse(written.splice(0).join(""));
          queue = Array.prototype.slice.call(output.querySelectorAll("script")).concat(queue);
          if (marker.parentNode) {
            marker.parentNode.insertBefore(output, marker);
            marker.parentNode.removeChild(marker);
          }
          next();
        }

        var waits = firesLoad(el);
        if (waits) el.onload = el.onerror = done;
        old.parentNode.replaceChild(el, old);
        if (!waits) done();
      })();
    });
})();
