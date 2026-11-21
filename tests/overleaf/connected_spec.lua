local overleaf = require('overleaf')
local bridge = require('overleaf.bridge')
local config = require('overleaf.config')

describe('OverleafConnected', function()
  local original_request, original_config, original_tree, events, autocmd

  before_each(function()
    original_request = bridge.request
    original_config = vim.deepcopy(config._config)
    -- Connecting opens the file tree; not under test here.
    original_tree = package.loaded['overleaf.tree']
    package.loaded['overleaf.tree'] = { toggle = function() end }
    events = {}
    autocmd = vim.api.nvim_create_autocmd('User', {
      pattern = 'OverleafConnected',
      callback = function(ev) table.insert(events, ev.data) end,
    })
  end)

  after_each(function()
    bridge.request = original_request
    config._config = original_config
    package.loaded['overleaf.tree'] = original_tree
    vim.api.nvim_del_autocmd(autocmd)
    overleaf._state.connected = false
  end)

  local function connect(err)
    bridge.request = function(method, _, callback)
      if method == 'connect' then
        callback(err, err == nil and { project = {} } or nil)
      elseif callback then
        callback(nil, {})
      end
    end
    overleaf._connect_project('cookie', 'abc123', 'My Paper')
    vim.wait(500, function() return #events > 0 end, 10)
  end

  it('fires with the project after connecting', function()
    connect(nil)
    assert.are.equal(1, #events)
    assert.are.same({
      project_id = 'abc123',
      project_name = 'My Paper',
      url = 'https://www.overleaf.com/project/abc123',
    }, events[1])
  end)

  it('uses base_url for self-hosted instances', function()
    config.setup({ base_url = 'https://latex.example.org' })
    connect(nil)
    assert.are.equal('https://latex.example.org/project/abc123', events[1].url)
  end)

  it('does not fire when connecting fails', function()
    connect({ message = 'nope' })
    assert.are.equal(0, #events)
  end)
end)
