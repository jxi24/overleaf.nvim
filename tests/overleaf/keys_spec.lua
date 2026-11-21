local overleaf = require('overleaf')
local config = require('overleaf.config')

local default_keys = {
  '<leader>oc',
  '<leader>od',
  '<leader>ob',
  '<leader>ot',
  '<leader>oo',
  '<leader>op',
  '<leader>or',
  '<leader>oR',
  '<leader>ox',
  '<leader>of',
}

local function mapped(lhs) return vim.fn.maparg(lhs, 'n') ~= '' end

describe('default keymaps', function()
  local original_config

  before_each(function()
    original_config = vim.deepcopy(config._config)
    for _, lhs in ipairs(default_keys) do
      pcall(vim.keymap.del, 'n', lhs)
    end
  end)

  after_each(function() config._config = original_config end)

  it('are set by default', function()
    overleaf.setup()
    for _, lhs in ipairs(default_keys) do
      assert.is_true(mapped(lhs), lhs .. ' should be mapped')
    end
  end)

  it('are set with keys = true', function()
    overleaf.setup({ keys = true })
    assert.is_true(mapped('<leader>oc'))
  end)

  it('are not set with keys = false', function()
    overleaf.setup({ keys = false })
    for _, lhs in ipairs(default_keys) do
      assert.is_false(mapped(lhs), lhs .. ' should not be mapped')
    end
  end)

  it('leave existing mappings alone with keys = false', function()
    vim.keymap.set('n', '<leader>ot', '<cmd>echo "mine"<cr>', { desc = 'mine' })
    overleaf.setup({ keys = false })
    assert.are.equal('mine', vim.fn.maparg('<leader>ot', 'n', false, true).desc)
  end)
end)
