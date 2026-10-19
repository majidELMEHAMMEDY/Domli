# Manage the Domli AI assistant (instructions, knowledge, on/off) from the super admin.
# The assistant itself runs in domli-bot; this page is its front door.
class SuperAdmin::DomliAiController < SuperAdmin::ApplicationController
  before_action :ensure_configured
  before_action :set_account_id, except: [:show]

  def show
    @accounts = client.accounts
    @account = @accounts.find { |account| account['id'] == params[:account_id].to_s } || @accounts.first
    @documents = @account ? client.documents(@account['id']) : []
  rescue DomliAi::BotClient::Error => e
    @error = e.message
    @accounts = []
    @documents = []
  end

  def update
    attributes = params.permit(:enabled, :mode, :instructions).to_h
    attributes['enabled'] = ActiveModel::Type::Boolean.new.cast(attributes['enabled']) if attributes.key?('enabled')
    perform { client.update_account(@account_id, attributes) }
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

  private

  def client
    @client ||= DomliAi::BotClient.new
  end

  def perform
    yield
    redirect_back_with(:notice, 'Opgeslagen.')
  rescue DomliAi::BotClient::Error => e
    redirect_back_with(:alert, e.message)
  end

  def redirect_back_with(type, message)
    redirect_to super_admin_domli_ai_path(account_id: @account_id), type => message
  end

  def set_account_id
    @account_id = params[:account_id].to_s
    head :bad_request unless @account_id.match?(/\A\d+\z/)
  end

  def ensure_configured
    @configured = DomliAi::BotClient.configured?
    return if @configured

    # The page itself explains how to connect the assistant service; the other actions need it.
    action_name == 'show' ? render(:show) : head(:service_unavailable)
  end
end
