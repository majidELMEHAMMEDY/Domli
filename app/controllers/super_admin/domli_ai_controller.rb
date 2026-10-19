# Manage the Domli AI assistant from the super admin: API key, per-customer settings, instructions, knowledge,
# and connecting the assistant to a customer's inbox. The assistant itself runs in domli-bot; this page is its front door.
class SuperAdmin::DomliAiController < SuperAdmin::ApplicationController
  BOT_NAME = 'Domli AI'.freeze

  before_action :ensure_configured
  before_action :set_account_id, except: [:show, :update_settings]

  def show
    @customers = Account.order(:id)
    @customer = @customers.find_by(id: params[:account_id]) || @customers.first
    @settings = client.settings
    @bot_accounts = client.accounts
    @bot_account = @bot_accounts.find { |account| account['id'] == @customer&.id.to_s }
    @documents = @bot_account ? client.documents(@customer.id) : []
    @inboxes = @customer ? @customer.inboxes.includes(:agent_bot).order(:id) : []
  rescue DomliAi::BotClient::Error => e
    @error = e.message
    @customers = Account.none
    @bot_accounts = []
    @documents = []
    @inboxes = []
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

  def client
    @client ||= DomliAi::BotClient.new
  end

  def account_attributes
    attributes = {}
    attributes['enabled'] = boolean(:enabled) if params.key?(:enabled)
    attributes['answerPrices'] = boolean(:answer_prices) if params.key?(:answer_prices)
    attributes['mode'] = params[:mode].to_s if params.key?(:mode)
    attributes['instructions'] = params[:instructions].to_s if params.key?(:instructions)
    attributes['businessName'] = params[:business_name].to_s if params.key?(:business_name)
    attributes['monthlyTokenCap'] = params[:monthly_token_cap].to_s.delete('.,').to_i if params.key?(:monthly_token_cap)
    attributes['appointments'] = appointments_attributes if params.key?(:appointment_provider)
    attributes
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
    redirect_to super_admin_domli_ai_path(account_id: @account_id), type => message
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
