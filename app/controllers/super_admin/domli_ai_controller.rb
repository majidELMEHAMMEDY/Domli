# Manage the Domli AI assistant from the super admin: Claude settings, and per customer the behaviour, hand-over rules,
# quick replies, knowledge, inbox connection and limits. The assistant itself runs in domli-bot; this page is its front door.
class SuperAdmin::DomliAiController < SuperAdmin::ApplicationController
  BOT_NAME = 'Domli AI'.freeze
  TABS = %w[overview behavior restrictions quick_replies knowledge connection limits test global].freeze
  RULE_FIELDS = %w[id type name reason promptHint disabledNote locked].freeze

  before_action :ensure_configured
  before_action :set_account_id, except: [:show, :update_settings]
  helper_method :current_tab

  def show
    load_page
  end

  # Shows what the assistant would do with a message, without sending anything to anyone.
  def test_message
    @test_message = params[:message].to_s
    begin
      @test_result = client.test_message(@account_id, @test_message)
    rescue DomliAi::BotClient::Error => e
      @test_error = e.message
    end
    load_page
    render :show
  end

  def update_settings
    @account_id = params[:account_id].to_s.presence
    attributes = {}
    attributes['anthropicApiKey'] = params[:anthropic_api_key].to_s.strip if params[:anthropic_api_key].present?
    attributes['anthropicApiKey'] = '' if params[:clear_api_key] == '1'
    attributes['model'] = params[:model].to_s if params.key?(:model)
    attributes['publicUrl'] = params[:public_url].to_s if params.key?(:public_url)
    perform { client.update_settings(attributes) }
  end

  def enable_account
    perform { client.create_account(@account_id, business_name: Account.find(@account_id).name) }
  end

  def update
    perform { client.update_account(@account_id, account_attributes) }
  end

  # Edits the rules shown on one tab: "handoff" (hand-over rules + appointments) or "reply" (quick replies).
  def update_rules
    perform { client.update_account(@account_id, { 'rules' => merged_rules }) }
  end

  def apply_preset
    perform { client.apply_preset(@account_id, params[:preset].to_s) }
  end

  def save_preset
    perform { client.save_preset(name: params[:preset_name].to_s, description: params[:preset_description].to_s, account_id: @account_id) }
  end

  def delete_preset
    perform { client.delete_preset(params[:preset].to_s) }
  end

  def remove_account
    perform { client.delete_account(@account_id) }
  end

  def create_document
    perform { client.add_text(@account_id, title: params[:title].to_s, text: params[:text].to_s) }
  end

  def import_url
    perform { client.import_url(@account_id, url: params[:url].to_s) }
  end

  def destroy_document
    return redirect_back_with(:alert, 'Ongeldig document') unless params[:id].to_s.match?(/\A([a-f0-9]{16}|legacy)\z/)

    perform { client.delete_document(@account_id, params[:id]) }
  end

  # Creates the "Domli AI" bot for this customer, hands its access token to the assistant service,
  # and attaches it to the chosen inbox, so nothing has to be copied around by hand.
  def connect
    webhook_url = client.settings['webhookUrl']
    return redirect_back_with(:alert, t('super_admin.domli_ai.need_public_url')) if webhook_url.blank?

    perform do
      account = Account.find(@account_id)
      inbox = account.inboxes.find(params[:inbox_id])
      bot = AgentBot.find_or_initialize_by(account_id: account.id, name: BOT_NAME)
      bot.update!(outgoing_url: webhook_url, description: 'Domli AI-assistent')
      token = (bot.access_token || AccessToken.create!(owner: bot)).token
      client.update_account(account.id, { 'chatwootBotToken' => token })
      AgentBotInbox.find_or_initialize_by(inbox: inbox).update!(agent_bot: bot, status: :active)
    end
  end

  def disconnect
    inbox = Account.find(@account_id).inboxes.find(params[:inbox_id])
    AgentBotInbox.where(inbox: inbox, agent_bot: AgentBot.where(account_id: @account_id, name: BOT_NAME)).destroy_all
    redirect_back_with(:notice, 'Opgeslagen.')
  end

  private

  def load_page
    @customers = Account.order(:id)
    @customer = @customers.find_by(id: params[:account_id]) || @customers.first
    @settings = client.settings
    @bot_accounts = client.accounts
    @bot_account = @bot_accounts.find { |account| account['id'] == @customer&.id.to_s }
    @presets = client.presets
    @documents = @bot_account && current_tab == 'knowledge' ? client.documents(@customer.id) : []
    @inboxes = @customer ? @customer.inboxes.includes(:agent_bot).order(:id) : []
    @agents = @customer ? @customer.users.order(:name) : []
  rescue DomliAi::BotClient::Error => e
    @error = e.message
    @customers = Account.none
    @bot_accounts = []
    @presets = []
    @documents = []
    @inboxes = []
    @agents = []
  end

  def current_tab
    TABS.include?(params[:tab]) ? params[:tab] : 'overview'
  end

  def client
    @client ||= DomliAi::BotClient.new
  end

  def account_attributes
    attributes = {}
    attributes['enabled'] = boolean(:enabled) if params.key?(:enabled)
    attributes['mode'] = params[:mode].to_s if params.key?(:mode)
    attributes['instructions'] = params[:instructions].to_s if params.key?(:instructions)
    attributes['businessName'] = params[:business_name].to_s if params.key?(:business_name)
    attributes['assistantName'] = params[:assistant_name].to_s if params.key?(:assistant_name)
    attributes['unknownBehavior'] = params[:unknown_behavior].to_s if params.key?(:unknown_behavior)
    attributes['model'] = params[:model].to_s if params.key?(:model)
    attributes['languages'] = Array(params[:languages]).map(&:to_s) if params.key?(:languages_submitted)
    attributes['monthlyTokenCap'] = params[:monthly_token_cap].to_s.delete('.,').to_i if params.key?(:monthly_token_cap)
    attributes['handoffMessage'] = { 'nl' => params[:handoff_message_nl].to_s, 'en' => params[:handoff_message_en].to_s } if params.key?(:handoff_message_nl)
    attributes['promptTemplate'] = prompt_template if params.key?(:prompt_template)
    attributes['appointments'] = appointments_attributes if params.key?(:appointment_provider)
    attributes['handoffAgentId'] = handoff_agent_id if params.key?(:handoff_agent_id)
    attributes
  end

  # Empty or "reset" gives back the built-in text.
  def prompt_template
    params[:reset_prompt_template] == '1' ? '' : params[:prompt_template].to_s
  end

  # Blank clears it; otherwise it must be a member of this account (raises RecordNotFound, shown as an alert).
  def handoff_agent_id
    return '' if params[:handoff_agent_id].blank?

    Account.find(@account_id).users.find(params[:handoff_agent_id]).id
  end

  def appointments_attributes
    {
      'provider' => params[:appointment_provider].to_s,
      'bookingUrl' => params[:appointment_booking_url].to_s,
      'appointmentTypeId' => params[:appointment_type_id].to_s,
      'apiKey' => params[:appointment_api_key].to_s,
      'apiSecret' => params[:appointment_api_secret].to_s
    }
  end

  # The whole list is sent back to the service, which validates it and keeps the locked rules switched on.
  def merged_rules
    scope_types = params[:rule_scope] == 'reply' ? %w[reply] : %w[handoff appointment]
    current = client.accounts.find { |account| account['id'] == @account_id }['rules']
    posted = (params[:rules]&.to_unsafe_h || {}).values.index_by { |rule| rule['id'] }

    rules = current.filter_map do |rule|
      next rule unless scope_types.include?(rule['type']) && (edit = posted[rule['id']])
      next if edit['delete'] == '1' && !rule['locked']

      rule.merge(rule_edit(edit))
    end
    rules << new_rule if params.dig(:new_rule, :name).present? && scope_types.include?(params[:new_rule][:type].to_s)
    rules
  end

  def rule_edit(edit)
    {
      'name' => edit['name'].to_s,
      'enabled' => ActiveModel::Type::Boolean.new.cast(edit['enabled']),
      'triggers' => edit['triggers'].to_s.split("\n").map(&:strip).compact_blank,
      'maxWords' => edit['max_words'].to_s.to_i,
      'reason' => edit['reason'].to_s,
      'promptHint' => edit['prompt_hint'].to_s,
      'message' => { 'nl' => edit['message_nl'].to_s, 'en' => edit['message_en'].to_s }
    }
  end

  def new_rule
    fresh = params[:new_rule].to_unsafe_h
    rule_edit(fresh.merge('enabled' => 'true')).merge('type' => fresh['type'].to_s)
  end

  def boolean(key)
    ActiveModel::Type::Boolean.new.cast(params[key])
  end

  def perform
    yield
    redirect_back_with(:notice, 'Opgeslagen.')
  rescue DomliAi::BotClient::Error, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound => e
    redirect_back_with(:alert, e.message)
  end

  def redirect_back_with(type, message)
    redirect_to super_admin_domli_ai_path(account_id: @account_id, tab: current_tab), type => message
  end

  def set_account_id
    @account_id = params[:account_id].to_s
    return head(:bad_request) unless @account_id.match?(/\A\d+\z/)

    head :not_found unless Account.exists?(@account_id)
  end

  def ensure_configured
    @configured = DomliAi::BotClient.configured?
    return if @configured

    # The page itself explains how to connect the assistant service; the other actions need it.
    action_name == 'show' ? render(:show) : head(:service_unavailable)
  end
end
