/* Remembers a light/dark choice. Three states, so "match device" stays available. */
(function () {
  var KEY = 'apple-day-docs-theme'
  var order = ['system', 'light', 'dark']
  var label = { system: 'Match device', light: 'Light', dark: 'Dark' }

  function read() {
    try { return localStorage.getItem(KEY) || 'system' } catch (e) { return 'system' }
  }
  function apply(choice) {
    if (choice === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', choice)
    var button = document.querySelector('.themer')
    if (button) button.textContent = label[choice]
  }
  function set(choice) {
    try { localStorage.setItem(KEY, choice) } catch (e) { /* private window */ }
    apply(choice)
  }

  /*
    The nav scrolls sideways on a narrow screen. Two things follow from that: the ends need
    to show there is more past them, and the page you are actually on has to be visible
    without going looking for it — landing on the last page with its link off to the right
    and no highlight in sight reads as no page being current at all.
  */
  function wireNav() {
    var nav = document.querySelector('.topbar nav')
    if (!nav) return

    function edges() {
      var more = nav.scrollWidth - nav.clientWidth
      nav.classList.toggle('can-left', nav.scrollLeft > 4)
      nav.classList.toggle('can-right', nav.scrollLeft < more - 4)
    }

    var here = nav.querySelector('[aria-current="page"]')
    if (here) {
      /*
        Measured against the nav's own box rather than with `offsetLeft`. The topbar is
        sticky, which makes it the offset parent, so `offsetLeft` is a distance from the bar
        and not from the start of the scrolling content — near enough for the middle links
        to look right and wrong at both ends.

        Only scrolled when it is actually out of view, so landing on the first page leaves
        the bar where it starts instead of nudging it.
      */
      var nb = nav.getBoundingClientRect()
      var ib = here.getBoundingClientRect()
      var pad = 16
      if (ib.left < nb.left + pad || ib.right > nb.right - pad) {
        nav.scrollLeft += ib.left - nb.left - (nav.clientWidth - ib.width) / 2
      }
    }

    edges()
    nav.addEventListener('scroll', edges, { passive: true })
    window.addEventListener('resize', edges)
  }

  apply(read())
  document.addEventListener('DOMContentLoaded', function () {
    apply(read())
    wireNav()
    var button = document.querySelector('.themer')
    if (!button) return
    button.addEventListener('click', function () {
      set(order[(order.indexOf(read()) + 1) % order.length])
    })
  })
})()
